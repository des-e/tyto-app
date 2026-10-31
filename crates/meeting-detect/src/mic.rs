use crate::MicUsage;

/// Return the strongest microphone-ownership signal available on this OS.
pub(crate) fn current_usage() -> MicUsage {
    platform::current_usage()
}

#[cfg(any(target_os = "linux", test))]
fn process_from_properties(properties: &serde_json::Map<String, serde_json::Value>) -> crate::ProcessInfo {
    let string = |key: &str| properties.get(key).and_then(serde_json::Value::as_str);
    let executable = string("application.process.binary").map(str::to_string);
    let name = string("application.name")
        .or_else(|| string("media.name"))
        .or(executable.as_deref())
        .unwrap_or("microphone client")
        .to_string();
    let pid = properties.get("application.process.id").and_then(|value| {
        value
            .as_u64()
            .and_then(|pid| u32::try_from(pid).ok())
            .or_else(|| value.as_str().and_then(|pid| pid.parse().ok()))
    });
    crate::ProcessInfo {
        pid,
        name,
        executable,
        bundle_id: None,
    }
}

#[cfg(any(target_os = "linux", test))]
fn parse_pactl_json(input: &str) -> Option<MicUsage> {
    let streams = serde_json::from_str::<serde_json::Value>(input).ok()?.as_array()?.clone();
    let mut processes = Vec::new();
    let mut active = false;
    for stream in streams {
        let Some(stream) = stream.as_object() else { continue };
        let is_active = match stream.get("corked").and_then(serde_json::Value::as_bool) {
            Some(corked) => !corked,
            None => stream
                .get("state")
                .and_then(serde_json::Value::as_str)
                .map(|state| state.eq_ignore_ascii_case("running"))
                .unwrap_or(true),
        };
        if !is_active {
            continue;
        }
        active = true;
        if let Some(properties) = stream.get("properties").and_then(serde_json::Value::as_object) {
            let process = process_from_properties(properties);
            if !processes.contains(&process) {
                processes.push(process);
            }
        }
    }
    Some(MicUsage {
        active,
        processes,
        owners_known: true,
    })
}

#[cfg(any(target_os = "linux", test))]
fn unquote_pactl_value(value: &str) -> String {
    let value = value.trim();
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(value)
        .replace("\\\"", "\"")
        .replace("\\\\", "\\")
}

#[cfg(any(target_os = "linux", test))]
fn parse_pactl_text(input: &str) -> Option<MicUsage> {
    let mut saw_stream = false;
    let mut streams: Vec<(bool, serde_json::Map<String, serde_json::Value>)> = Vec::new();
    let mut current: Option<(bool, serde_json::Map<String, serde_json::Value>)> = None;

    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Source Output #") {
            saw_stream = true;
            if let Some(stream) = current.take() {
                streams.push(stream);
            }
            current = Some((true, serde_json::Map::new()));
            continue;
        }
        let Some((active, properties)) = current.as_mut() else {
            continue;
        };
        if let Some(value) = trimmed.strip_prefix("Corked:") {
            *active = !value.trim().eq_ignore_ascii_case("yes");
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if matches!(
            key,
            "application.name" | "application.process.binary" | "application.process.id" | "media.name"
        ) {
            properties.insert(key.to_string(), serde_json::Value::String(unquote_pactl_value(value)));
        }
    }
    if let Some(stream) = current {
        streams.push(stream);
    }
    if !saw_stream {
        return None;
    }

    let mut processes = Vec::new();
    let mut active = false;
    for (stream_active, properties) in streams {
        if !stream_active {
            continue;
        }
        active = true;
        let process = process_from_properties(&properties);
        if !processes.contains(&process) {
            processes.push(process);
        }
    }
    Some(MicUsage {
        active,
        processes,
        owners_known: true,
    })
}

#[cfg(any(target_os = "windows", test))]
fn decode_windows_executable_key(key: &str) -> String {
    key.replace('#', "\\")
}

/// One WASAPI audio session on a capture endpoint.
#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CaptureSession {
    pid: u32,
    /// `AudioSessionStateActive`: the client is capturing right now, not just holding the session.
    active: bool,
    /// The shared system-sounds session, which belongs to no application.
    system: bool,
}

/// Pids that own the microphone: active, non-system sessions of other processes, deduplicated in
/// the order the OS listed them. Our own recorder must never look like a meeting.
#[cfg(any(target_os = "windows", test))]
fn owners_from_sessions(sessions: &[CaptureSession], own_pid: u32) -> Vec<u32> {
    let mut pids = Vec::new();
    for session in sessions {
        if session.active && !session.system && session.pid != 0 && session.pid != own_pid && !pids.contains(&session.pid) {
            pids.push(session.pid);
        }
    }
    pids
}

/// Combine the two Windows signals.
///
/// `wasapi` is `None` when the session API failed. The registry is the fallback: it is read only
/// when WASAPI named no owner, and counts only when it shows an app in use — current Windows builds
/// stop updating it, while an exotic driver may hide its sessions from WASAPI. `registry` returns
/// `None` when the consent store cannot be opened at all.
#[cfg(any(target_os = "windows", test))]
fn merge_windows_usage(
    wasapi: Option<Vec<crate::ProcessInfo>>,
    registry: impl FnOnce() -> Option<Vec<crate::ProcessInfo>>,
) -> MicUsage {
    let wasapi_known = wasapi.is_some();
    if let Some(owners) = wasapi.filter(|owners| !owners.is_empty()) {
        return MicUsage {
            active: true,
            processes: owners,
            owners_known: true,
        };
    }
    match registry() {
        Some(owners) if !owners.is_empty() => MicUsage {
            active: true,
            processes: owners,
            owners_known: true,
        },
        registry => MicUsage {
            active: false,
            processes: Vec::new(),
            owners_known: wasapi_known || registry.is_some(),
        },
    }
}

#[cfg(target_os = "windows")]
mod wasapi {
    use super::CaptureSession;
    use windows::core::Interface;
    use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, S_OK};
    use windows::Win32::Media::Audio::{
        eCapture, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
        DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

    /// COM on the calling (detector) thread for the duration of one poll.
    struct Apartment {
        /// Only an initialisation we made ourselves is undone.
        owned: bool,
    }

    impl Apartment {
        fn enter() -> Option<Self> {
            let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            if result.is_ok() {
                // S_OK or S_FALSE: both must be balanced by CoUninitialize.
                Some(Self { owned: true })
            } else if result == RPC_E_CHANGED_MODE {
                // Already a single-threaded apartment here; COM is usable as it is.
                Some(Self { owned: false })
            } else {
                None
            }
        }
    }

    impl Drop for Apartment {
        fn drop(&mut self) {
            if self.owned {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn enumerate() -> windows::core::Result<Vec<CaptureSession>> {
        let mut sessions = Vec::new();
        unsafe {
            let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let collection = devices.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)?;
            for index in 0..collection.GetCount()? {
                // One broken device must not hide the sessions of the others.
                let Ok(device) = collection.Item(index) else { continue };
                let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
                    continue;
                };
                let Ok(list) = manager.GetSessionEnumerator() else { continue };
                let Ok(count) = list.GetCount() else { continue };
                for position in 0..count {
                    let Ok(control) = list.GetSession(position) else { continue };
                    let Ok(control) = control.cast::<IAudioSessionControl2>() else {
                        continue;
                    };
                    let Ok(pid) = control.GetProcessId() else { continue };
                    let active = control.GetState().is_ok_and(|state| state == AudioSessionStateActive);
                    // Called through the vtable: it answers S_OK or S_FALSE, and a `Result` wrapper
                    // would fold both into `Ok`.
                    let system = (Interface::vtable(&control).IsSystemSoundsSession)(Interface::as_raw(&control)) == S_OK;
                    sessions.push(CaptureSession { pid, active, system });
                }
            }
        }
        Ok(sessions)
    }

    /// Every session on every active capture endpoint, or `None` when COM or the endpoint list
    /// failed. Takes milliseconds, so it is fine on every detector poll.
    pub(super) fn capture_sessions() -> Option<Vec<CaptureSession>> {
        let _apartment = Apartment::enter()?;
        match enumerate() {
            Ok(sessions) => Some(sessions),
            Err(error) => {
                tracing::debug!("WASAPI capture sessions unavailable: {error}");
                None
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use crate::{MicUsage, ProcessInfo};
    use std::path::Path;
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    const CONSENT_STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

    fn is_active(key: &RegKey) -> bool {
        matches!(key.get_value::<u64, _>("LastUsedTimeStop"), Ok(0))
    }

    fn nonpackaged_owner(owner_key: &str) -> ProcessInfo {
        let executable = super::decode_windows_executable_key(owner_key);
        let name = Path::new(&executable)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or(owner_key)
            .to_string();
        ProcessInfo {
            pid: None,
            name,
            executable: Some(executable),
            bundle_id: None,
        }
    }

    fn collect_nonpackaged(key: &RegKey, owner: Option<&str>, processes: &mut Vec<ProcessInfo>) {
        if is_active(key) {
            if let Some(owner) = owner {
                let process = nonpackaged_owner(owner);
                if !processes.contains(&process) {
                    processes.push(process);
                }
            }
        }
        for child_name in key.enum_keys().flatten() {
            if let Ok(child) = key.open_subkey(&child_name) {
                collect_nonpackaged(&child, owner.or(Some(&child_name)), processes);
            }
        }
    }

    /// Resolve pids by matching image paths against the process list.
    ///
    /// Enumerating every process is by far the most expensive thing this module does, so it is
    /// confined to the one case that needs the result: matching a browser window title to find
    /// Meet. Zoom and Teams are identified by the consent-store key alone, and an idle machine
    /// never pays for it at all.
    fn attach_pids(processes: &mut [ProcessInfo]) {
        let mut wanted: Vec<&mut ProcessInfo> = processes
            .iter_mut()
            .filter(|owner| owner.executable.is_some() && crate::process::source(owner) == Some(crate::ProcessKind::Browser))
            .collect();
        if wanted.is_empty() {
            return;
        }

        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
        );
        for owner in &mut wanted {
            let Some(expected) = owner.executable.as_deref() else {
                continue;
            };
            owner.pid = system.processes().values().find_map(|process| {
                let actual = process.exe()?.to_string_lossy();
                actual.eq_ignore_ascii_case(expected).then(|| process.pid().as_u32())
            });
        }
    }

    /// Identify session pids one by one — never the whole process list. A pid whose parent is this
    /// process (a recorder sidecar) is ours and dropped, like our own pid.
    fn session_owners(pids: &[u32], own_pid: u32) -> Vec<ProcessInfo> {
        if pids.is_empty() {
            return Vec::new();
        }
        let wanted: Vec<Pid> = pids.iter().map(|pid| Pid::from_u32(*pid)).collect();
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&wanted),
            false,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
        );
        let mut owners = Vec::new();
        for &pid in pids {
            let process = system.process(Pid::from_u32(pid));
            if process
                .and_then(|process| process.parent())
                .is_some_and(|parent| parent.as_u32() == own_pid)
            {
                continue;
            }
            let executable = process
                .and_then(|process| process.exe())
                .map(|path| path.to_string_lossy().into_owned());
            let name = process
                .map(|process| process.name().to_string_lossy().into_owned())
                .filter(|name| !name.is_empty())
                .or_else(|| {
                    executable
                        .as_deref()
                        .and_then(|path| Path::new(path).file_name())
                        .and_then(|name| name.to_str())
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| format!("pid {pid}"));
            owners.push(ProcessInfo {
                pid: Some(pid),
                name,
                executable,
                bundle_id: None,
            });
        }
        owners
    }

    fn wasapi_owners() -> Option<Vec<ProcessInfo>> {
        let own_pid = std::process::id();
        let sessions = super::wasapi::capture_sessions()?;
        Some(session_owners(&super::owners_from_sessions(&sessions, own_pid), own_pid))
    }

    pub(super) fn current_usage() -> MicUsage {
        super::merge_windows_usage(wasapi_owners(), registry_owners)
    }

    /// Apps the consent store marks as using the microphone right now; `None` when it cannot be read.
    fn registry_owners() -> Option<Vec<ProcessInfo>> {
        let store = RegKey::predef(HKEY_CURRENT_USER).open_subkey(CONSENT_STORE).ok()?;
        let mut processes = Vec::new();
        for child_name in store.enum_keys().flatten() {
            let Ok(child) = store.open_subkey(&child_name) else {
                continue;
            };
            if child_name.eq_ignore_ascii_case("NonPackaged") {
                collect_nonpackaged(&child, None, &mut processes);
            } else if is_active(&child) {
                processes.push(ProcessInfo {
                    pid: None,
                    name: child_name.clone(),
                    executable: None,
                    bundle_id: Some(child_name),
                });
            }
        }
        attach_pids(&mut processes);
        Some(processes)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use crate::MicUsage;
    use std::process::Command;

    fn output(args: &[&str]) -> Option<String> {
        let output = Command::new("pactl").args(args).output().ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
    }

    pub(super) fn current_usage() -> MicUsage {
        if let Some(usage) = output(&["-f", "json", "list", "source-outputs"])
            .as_deref()
            .and_then(super::parse_pactl_json)
        {
            return usage;
        }
        output(&["list", "source-outputs"])
            .as_deref()
            .and_then(super::parse_pactl_text)
            .unwrap_or_default()
    }
}

#[cfg(target_os = "macos")]
pub(crate) use platform::input_owner_pids;

#[cfg(target_os = "macos")]
mod platform {
    use crate::{MicUsage, ProcessInfo};
    use coreaudio_sys::{
        kAudioDevicePropertyDeviceIsRunningSomewhere, kAudioHardwarePropertyDefaultInputDevice, kAudioObjectPropertyElementMain,
        kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject, AudioDeviceID, AudioObjectGetPropertyData,
        AudioObjectGetPropertyDataSize, AudioObjectID, AudioObjectPropertyAddress,
    };
    use std::{ffi::c_void, mem::size_of, ptr};
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    /// AudioHardware.h selectors from macOS 14.2. Spelled out here so the build does not depend on
    /// the SDK that `coreaudio-sys` generated its bindings against.
    const fn four_cc(code: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*code)
    }
    const PROCESS_OBJECT_LIST: u32 = four_cc(b"prs#");
    const PROCESS_PID: u32 = four_cc(b"ppid");
    const PROCESS_IS_RUNNING_INPUT: u32 = four_cc(b"piri");
    /// How far up the parent chain an unrecognised owner (a browser's audio helper) is followed.
    const MAX_ANCESTORS: usize = 4;

    fn address(selector: u32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        }
    }

    unsafe fn property<T: Copy>(object: u32, selector: u32, value: &mut T) -> bool {
        let address = address(selector);
        let mut size = size_of::<T>() as u32;
        unsafe {
            AudioObjectGetPropertyData(object, &address, 0, ptr::null(), &mut size, value as *mut T as *mut c_void) == 0
                && size as usize == size_of::<T>()
        }
    }

    /// Pids of every process currently taking audio input, from the CoreAudio process objects.
    /// `None` when the OS does not have that list (macOS before 14.2).
    pub(crate) fn input_owner_pids() -> Option<Vec<u32>> {
        let address = address(PROCESS_OBJECT_LIST);
        let mut size = 0_u32;
        if unsafe { AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, ptr::null(), &mut size) } != 0 {
            return None;
        }
        let mut objects: Vec<AudioObjectID> = vec![0; size as usize / size_of::<AudioObjectID>()];
        if !objects.is_empty() {
            let mut size = (objects.len() * size_of::<AudioObjectID>()) as u32;
            let status = unsafe {
                AudioObjectGetPropertyData(
                    kAudioObjectSystemObject,
                    &address,
                    0,
                    ptr::null(),
                    &mut size,
                    objects.as_mut_ptr().cast::<c_void>(),
                )
            };
            if status != 0 {
                return None;
            }
            objects.truncate(size as usize / size_of::<AudioObjectID>());
        }

        let mut pids = Vec::new();
        for object in objects {
            let mut running: u32 = 0;
            if !unsafe { property(object, PROCESS_IS_RUNNING_INPUT, &mut running) } || running == 0 {
                continue;
            }
            let mut pid: i32 = 0;
            if !unsafe { property(object, PROCESS_PID, &mut pid) } {
                continue;
            }
            if let Ok(pid) = u32::try_from(pid) {
                if pid > 0 && !pids.contains(&pid) {
                    pids.push(pid);
                }
            }
        }
        Some(pids)
    }

    /// Identity of one pid, plus its parent pid. Apps come from `NSRunningApplication`; anything
    /// else (helpers, command-line tools) from the process table.
    fn identify(system: &mut System, pid: u32) -> (ProcessInfo, Option<u32>) {
        let sys_pid = Pid::from_u32(pid);
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[sys_pid]),
            false,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
        );
        let process = system.process(sys_pid);
        let parent = process.and_then(|process| process.parent()).map(|parent| parent.as_u32());
        let info = crate::process::application_info(pid).unwrap_or_else(|| ProcessInfo {
            pid: Some(pid),
            name: process
                .map(|process| process.name().to_string_lossy().into_owned())
                .unwrap_or_else(|| format!("pid {pid}")),
            executable: process
                .and_then(|process| process.exe())
                .map(|path| path.to_string_lossy().into_owned()),
            bundle_id: None,
        });
        (info, parent)
    }

    /// Every owner is reported as itself. A browser captures the microphone from a helper process
    /// that is not recognised on its own, so for an unrecognised owner the first recognised
    /// ancestor (the browser that owns the Meet window) is added as well.
    fn owners(pids: &[u32]) -> Vec<ProcessInfo> {
        let mut system = System::new();
        let mut processes: Vec<ProcessInfo> = Vec::new();
        fn push(processes: &mut Vec<ProcessInfo>, info: ProcessInfo) {
            if !processes.contains(&info) {
                processes.push(info);
            }
        }
        for &pid in pids {
            let (info, mut parent) = identify(&mut system, pid);
            let recognised = crate::process::source(&info).is_some();
            push(&mut processes, info);
            if recognised {
                continue;
            }
            for _ in 0..MAX_ANCESTORS {
                let Some(ancestor) = parent.filter(|pid| *pid > 1) else {
                    break;
                };
                let (info, next) = identify(&mut system, ancestor);
                if crate::process::source(&info).is_some() {
                    push(&mut processes, info);
                    break;
                }
                parent = next;
            }
        }
        processes
    }

    pub(super) fn current_usage() -> MicUsage {
        let mut device: AudioDeviceID = 0;
        if !unsafe {
            property(
                kAudioObjectSystemObject,
                kAudioHardwarePropertyDefaultInputDevice,
                &mut device,
            )
        } || device == 0
        {
            return MicUsage::default();
        }
        let mut running: u32 = 0;
        let active = unsafe { property(device, kAudioDevicePropertyDeviceIsRunningSomewhere, &mut running) } && running != 0;
        if !active {
            return MicUsage::default();
        }
        let pids = super::input_owner_pids();
        let owners_known = pids.is_some();
        let processes = match pids {
            Some(pids) if !pids.is_empty() => owners(&pids),
            // Older macOS, or an owner the list does not show: the caller falls back to the
            // running known apps, as before.
            _ => Vec::new(),
        };
        MicUsage {
            active,
            processes,
            owners_known,
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
mod platform {
    use crate::MicUsage;

    pub(super) fn current_usage() -> MicUsage {
        MicUsage::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_active_and_corked_pactl_json_streams() {
        let input = r#"[
          {"corked": false, "properties": {
            "application.name": "Firefox", "application.process.binary": "firefox", "application.process.id": "42"
          }},
          {"corked": true, "properties": {"application.name": "Ignored"}}
        ]"#;
        let usage = parse_pactl_json(input).unwrap();
        assert!(usage.active);
        assert_eq!(usage.processes.len(), 1);
        assert_eq!(usage.processes[0].pid, Some(42));
        assert_eq!(usage.processes[0].executable.as_deref(), Some("firefox"));
    }

    #[test]
    fn rejects_malformed_json_and_parses_text_fallback() {
        assert!(parse_pactl_json("not json").is_none());
        let text = r#"
Source Output #17
    Corked: no
    Properties:
        application.name = "Microsoft Teams"
        application.process.binary = "ms-teams"
        application.process.id = "501"
Source Output #18
    Corked: yes
    Properties:
        application.name = "Muted"
"#;
        let usage = parse_pactl_text(text).unwrap();
        assert!(usage.active);
        assert_eq!(usage.processes.len(), 1);
        assert_eq!(usage.processes[0].name, "Microsoft Teams");
        assert_eq!(usage.processes[0].pid, Some(501));
        assert!(parse_pactl_text("garbage").is_none());
    }

    fn session(pid: u32, active: bool, system: bool) -> CaptureSession {
        CaptureSession { pid, active, system }
    }

    fn owner(name: &str) -> crate::ProcessInfo {
        crate::ProcessInfo {
            pid: Some(7),
            name: name.into(),
            executable: None,
            bundle_id: None,
        }
    }

    #[test]
    fn capture_owners_are_active_foreign_non_system_pids_in_order() {
        let sessions = [
            session(30, true, false),
            session(10, false, false), // inactive
            session(20, true, true),   // system sounds
            session(99, true, false),  // ourselves
            session(0, true, false),   // no single process
            session(40, true, false),
            session(30, true, false), // second endpoint, same client
        ];
        assert_eq!(owners_from_sessions(&sessions, 99), vec![30, 40]);
        assert!(owners_from_sessions(&[], 99).is_empty());
    }

    #[test]
    fn wasapi_owners_win_without_reading_the_registry() {
        let usage = merge_windows_usage(Some(vec![owner("browser.exe")]), || panic!("registry must not be read"));
        assert!(usage.active && usage.owners_known);
        assert_eq!(usage.processes, vec![owner("browser.exe")]);
    }

    #[test]
    fn empty_wasapi_answer_is_idle_unless_the_registry_shows_an_app_in_use() {
        let idle = merge_windows_usage(Some(Vec::new()), || Some(Vec::new()));
        assert!(!idle.active && idle.owners_known && idle.processes.is_empty());

        let hidden = merge_windows_usage(Some(Vec::new()), || Some(vec![owner("Zoom.exe")]));
        assert!(hidden.active && hidden.owners_known);
        assert_eq!(hidden.processes, vec![owner("Zoom.exe")]);
    }

    #[test]
    fn failed_wasapi_falls_back_to_the_registry() {
        let fallback = merge_windows_usage(None, || Some(vec![owner("Teams.exe")]));
        assert!(fallback.active);
        assert_eq!(fallback.processes, vec![owner("Teams.exe")]);

        let unreadable = merge_windows_usage(None, || None);
        assert!(!unreadable.active && !unreadable.owners_known);
        assert!(merge_windows_usage(None, || Some(Vec::new())).owners_known);
    }

    #[test]
    fn decodes_windows_nonpackaged_executable_keys() {
        assert_eq!(
            decode_windows_executable_key(r"C:#Program Files#Zoom#bin#Zoom.exe"),
            r"C:\Program Files\Zoom\bin\Zoom.exe"
        );
    }
}
