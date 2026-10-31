use crate::{ProcessInfo, WindowInfo};

pub(crate) fn meet_process(browsers: &[ProcessInfo]) -> Option<ProcessInfo> {
    platform::meet_process(browsers)
}

pub(crate) fn visible_windows() -> Vec<WindowInfo> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        platform::visible_windows()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Vec::new()
    }
}

#[cfg(target_os = "macos")]
pub(crate) use platform::{request_screen_recording, screen_recording_granted};

pub(crate) fn is_meet_title(title: &str) -> bool {
    let title = title.trim();
    title == "Google Meet" || title.starts_with("Meet – ") || title.starts_with("Meet - ")
}

fn matching_browser(browsers: &[ProcessInfo], pid: u32, title: &str) -> Option<ProcessInfo> {
    if !is_meet_title(title) {
        return None;
    }
    browsers.iter().find(|browser| browser.pid == Some(pid)).cloned()
}

/// A Chromium browser captures audio in a utility child of the same executable, so the owner pid
/// differs from the pid of its windows; the executable path still ties the two together.
#[cfg(any(target_os = "windows", test))]
fn browser_with_executable(browsers: &[ProcessInfo], executable: &str) -> Option<ProcessInfo> {
    browsers
        .iter()
        .find(|browser| {
            browser
                .executable
                .as_deref()
                .is_some_and(|path| path.eq_ignore_ascii_case(executable))
        })
        .cloned()
}

#[cfg(target_os = "windows")]
mod platform {
    use super::matching_browser;
    use crate::{ProcessInfo, WindowInfo};
    use std::ffi::c_void;
    use std::mem::size_of;
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    };

    fn window_text(window: HWND) -> String {
        let mut buffer = [0_u16; 1024];
        let length = unsafe { GetWindowTextW(window, &mut buffer) };
        if length <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buffer[..length as usize])
    }

    /// Windows on another virtual desktop, or suspended UWP frames, are "visible" but cloaked.
    fn is_cloaked(window: HWND) -> bool {
        let mut cloaked: u32 = 0;
        let read = unsafe {
            DwmGetWindowAttribute(
                window,
                DWMWA_CLOAKED,
                (&mut cloaked as *mut u32).cast::<c_void>(),
                size_of::<u32>() as u32,
            )
        };
        read.is_ok() && cloaked != 0
    }

    unsafe extern "system" fn collect_window(window: HWND, parameter: LPARAM) -> BOOL {
        let windows = unsafe { &mut *(parameter.0 as *mut Vec<WindowInfo>) };
        if !unsafe { IsWindowVisible(window) }.as_bool() || is_cloaked(window) {
            return BOOL(1);
        }
        let mut rect = RECT::default();
        if unsafe { GetWindowRect(window, &mut rect) }.is_err() {
            return BOOL(1);
        }
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
        windows.push(WindowInfo {
            id: window.0 as usize as u64,
            pid,
            title: window_text(window),
            process_name: String::new(),
            width: u32::try_from(rect.right.saturating_sub(rect.left)).unwrap_or(0),
            height: u32::try_from(rect.bottom.saturating_sub(rect.top)).unwrap_or(0),
        });
        BOOL(1)
    }

    pub(super) fn visible_windows() -> Vec<WindowInfo> {
        let mut windows: Vec<WindowInfo> = Vec::new();
        let parameter = LPARAM((&mut windows as *mut Vec<WindowInfo>) as isize);
        // The callback never stops early, so a failure here is a genuine API error; whatever was
        // collected before it is still returned.
        let _ = unsafe { EnumWindows(Some(collect_window), parameter) };

        let mut pids: Vec<Pid> = windows.iter().map(|window| Pid::from_u32(window.pid)).collect();
        pids.sort_unstable();
        pids.dedup();
        let mut system = System::new();
        system.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), true, ProcessRefreshKind::nothing());
        for window in &mut windows {
            if let Some(process) = system.process(Pid::from_u32(window.pid)) {
                window.process_name = process.name().to_string_lossy().into_owned();
            }
        }
        windows
    }

    struct Search<'a> {
        browsers: &'a [ProcessInfo],
        found: Option<ProcessInfo>,
        /// Whether a browser's executable is known, so windows of other pids are worth reading.
        by_executable: bool,
        /// Pids of Meet-titled windows that belong to none of the browser pids.
        other_meet_pids: Vec<u32>,
    }

    unsafe extern "system" fn inspect_window(window: HWND, parameter: LPARAM) -> BOOL {
        let search = unsafe { &mut *(parameter.0 as *mut Search<'_>) };
        if !unsafe { IsWindowVisible(window) }.as_bool() {
            return BOOL(1);
        }

        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
        let known = search.browsers.iter().any(|browser| browser.pid == Some(pid));
        if !known && !search.by_executable {
            return BOOL(1);
        }

        let mut buffer = [0_u16; 1024];
        let length = unsafe { GetWindowTextW(window, &mut buffer) };
        if length <= 0 {
            return BOOL(1);
        }

        let title = String::from_utf16_lossy(&buffer[..length as usize]);
        if !known {
            if super::is_meet_title(&title) && !search.other_meet_pids.contains(&pid) {
                search.other_meet_pids.push(pid);
            }
            return BOOL(1);
        }
        search.found = matching_browser(search.browsers, pid, &title);
        if search.found.is_some() {
            BOOL(0)
        } else {
            BOOL(1)
        }
    }

    /// The browser whose executable runs one of `pids`; only those pids are looked up.
    fn browser_by_executable(browsers: &[ProcessInfo], pids: &[u32]) -> Option<ProcessInfo> {
        let wanted: Vec<Pid> = pids.iter().map(|pid| Pid::from_u32(*pid)).collect();
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&wanted),
            false,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
        );
        wanted.iter().find_map(|pid| {
            let executable = system.process(*pid)?.exe()?.to_string_lossy().into_owned();
            super::browser_with_executable(browsers, &executable)
        })
    }

    pub(super) fn meet_process(browsers: &[ProcessInfo]) -> Option<ProcessInfo> {
        let mut search = Search {
            browsers,
            found: None,
            by_executable: browsers.iter().any(|browser| browser.executable.is_some()),
            other_meet_pids: Vec::new(),
        };
        let parameter = LPARAM((&mut search as *mut Search<'_>) as isize);
        // Stopping enumeration after a match reports an error, so the result itself is intentionally
        // ignored. A genuine API failure and an empty search both safely produce `None`.
        let _ = unsafe { EnumWindows(Some(inspect_window), parameter) };
        if search.found.is_some() || search.other_meet_pids.is_empty() {
            return search.found;
        }
        // The microphone owner is a browser's audio-service child: its windows live in the main
        // process of the same executable.
        browser_by_executable(browsers, &search.other_meet_pids)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::matching_browser;
    use crate::ProcessInfo;
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{Atom, AtomEnum, ConnectionExt, Window};

    fn environment_is_wayland() -> bool {
        let session_type = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        if session_type.eq_ignore_ascii_case("wayland") {
            return true;
        }
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some_and(|value| !value.is_empty());
        let x11 = std::env::var_os("DISPLAY").is_some_and(|value| !value.is_empty());
        wayland && !x11
    }

    fn atom(connection: &impl Connection, name: &[u8]) -> Option<Atom> {
        connection.intern_atom(false, name).ok()?.reply().ok().map(|reply| reply.atom)
    }

    fn property(
        connection: &impl Connection,
        window: Window,
        property: Atom,
        property_type: Atom,
    ) -> Option<x11rb::protocol::xproto::GetPropertyReply> {
        connection
            .get_property(false, window, property, property_type, 0, u32::MAX)
            .ok()?
            .reply()
            .ok()
    }

    pub(super) fn first_cardinal(reply: &x11rb::protocol::xproto::GetPropertyReply) -> Option<u32> {
        if reply.format != 32 {
            return None;
        }
        reply.value32()?.next()
    }

    pub(super) fn utf8_title(reply: x11rb::protocol::xproto::GetPropertyReply) -> Option<String> {
        if reply.format != 8 {
            return None;
        }
        String::from_utf8(reply.value).ok()
    }

    fn legacy_title(reply: x11rb::protocol::xproto::GetPropertyReply) -> Option<String> {
        if reply.format != 8 {
            return None;
        }
        Some(reply.value.into_iter().map(char::from).collect())
    }

    pub(super) fn meet_process(browsers: &[ProcessInfo]) -> Option<ProcessInfo> {
        if browsers.is_empty() || environment_is_wayland() {
            return None;
        }

        let (connection, screen_index) = x11rb::connect(None).ok()?;
        let root = connection.setup().roots.get(screen_index)?.root;
        let client_list = atom(&connection, b"_NET_CLIENT_LIST")?;
        let pid_atom = atom(&connection, b"_NET_WM_PID")?;
        let name_atom = atom(&connection, b"_NET_WM_NAME")?;
        let utf8_string = atom(&connection, b"UTF8_STRING")?;
        let windows = property(&connection, root, client_list, AtomEnum::WINDOW.into())?;

        for window in windows.value32()? {
            let pid = property(&connection, window, pid_atom, AtomEnum::CARDINAL.into())
                .as_ref()
                .and_then(first_cardinal);
            let Some(pid) = pid else { continue };
            if !browsers.iter().any(|browser| browser.pid == Some(pid)) {
                continue;
            }

            let title = property(&connection, window, name_atom, utf8_string)
                .and_then(utf8_title)
                .or_else(|| property(&connection, window, AtomEnum::WM_NAME.into(), AtomEnum::ANY.into()).and_then(legacy_title));
            if let Some(browser) = title.and_then(|title| matching_browser(browsers, pid, &title)) {
                return Some(browser);
            }
        }
        None
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::matching_browser;
    use crate::{ProcessInfo, WindowInfo};
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::access::ScreenCaptureAccess;
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowBounds, kCGWindowLayer, kCGWindowListExcludeDesktopElements,
        kCGWindowListOptionOnScreenOnly, kCGWindowName, kCGWindowNumber, kCGWindowOwnerName, kCGWindowOwnerPID,
    };
    use std::ffi::c_void;

    fn value(dictionary: &CFDictionary, key: CFStringRef) -> Option<CFType> {
        let raw = *dictionary.find(key.cast::<c_void>())?;
        Some(unsafe { CFType::wrap_under_get_rule(raw.cast()) })
    }

    fn number(dictionary: &CFDictionary, key: CFStringRef) -> Option<CFNumber> {
        value(dictionary, key)?.downcast::<CFNumber>()
    }

    fn string(dictionary: &CFDictionary, key: CFStringRef) -> Option<String> {
        Some(value(dictionary, key)?.downcast::<CFString>()?.to_string())
    }

    /// `kCGWindowBounds` is a CGRect dictionary: `X`, `Y`, `Width`, `Height`.
    fn size(dictionary: &CFDictionary) -> (u32, u32) {
        let Some(bounds) = value(dictionary, unsafe { kCGWindowBounds }).and_then(|bounds| bounds.downcast::<CFDictionary>())
        else {
            return (0, 0);
        };
        let side = |name: &'static str| {
            let key = CFString::from_static_string(name);
            number(&bounds, key.as_concrete_TypeRef())
                .and_then(|value| value.to_f64())
                .filter(|value| value.is_finite() && *value > 0.0)
                .map_or(0, |value| value.round().min(f64::from(u32::MAX)) as u32)
        };
        (side("Width"), side("Height"))
    }

    fn window_info(dictionary: &CFDictionary) -> Option<WindowInfo> {
        // Layer 0 is ordinary application windows; menus, the Dock and overlays sit above it.
        if number(dictionary, unsafe { kCGWindowLayer })?.to_i64()? != 0 {
            return None;
        }
        let id = u64::try_from(number(dictionary, unsafe { kCGWindowNumber })?.to_i64()?).ok()?;
        let pid = u32::try_from(number(dictionary, unsafe { kCGWindowOwnerPID })?.to_i64()?).ok()?;
        let (width, height) = size(dictionary);
        Some(WindowInfo {
            id,
            pid,
            // Without the Screen Recording permission titles are simply absent.
            title: string(dictionary, unsafe { kCGWindowName }).unwrap_or_default(),
            process_name: string(dictionary, unsafe { kCGWindowOwnerName }).unwrap_or_default(),
            width,
            height,
        })
    }

    pub(super) fn visible_windows() -> Vec<WindowInfo> {
        let Some(windows) = copy_window_info(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID,
        ) else {
            return Vec::new();
        };
        windows
            .get_all_values()
            .into_iter()
            .filter_map(|raw| {
                let object = unsafe { CFType::wrap_under_get_rule(raw.cast()) };
                window_info(&object.downcast::<CFDictionary>()?)
            })
            .collect()
    }

    fn window_identity(dictionary: &CFDictionary) -> Option<(u32, String)> {
        let pid = value(dictionary, unsafe { kCGWindowOwnerPID })?
            .downcast::<CFNumber>()?
            .to_i64()?;
        let pid = u32::try_from(pid).ok()?;
        let title = value(dictionary, unsafe { kCGWindowName })?
            .downcast::<CFString>()?
            .to_string();
        Some((pid, title))
    }

    pub(crate) fn screen_recording_granted() -> bool {
        ScreenCaptureAccess.preflight()
    }

    /// Shows the system prompt, and registers the app in System Settings so the user can grant it
    /// later. macOS only ever asks once per app identity; after that this returns the standing answer.
    pub(crate) fn request_screen_recording() -> bool {
        ScreenCaptureAccess.request()
    }

    pub(super) fn meet_process(browsers: &[ProcessInfo]) -> Option<ProcessInfo> {
        if browsers.is_empty() {
            return None;
        }
        if !ScreenCaptureAccess.preflight() {
            // Without this permission the window list comes back with no titles at all, which is
            // indistinguishable from "no meeting" — so say it out loud rather than return silence.
            tracing::warn!("screen recording permission missing; Google Meet cannot be detected");
            return None;
        }

        let windows = copy_window_info(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID,
        )?;
        for raw in windows.get_all_values() {
            let object = unsafe { CFType::wrap_under_get_rule(raw.cast()) };
            let Some(dictionary) = object.downcast::<CFDictionary>() else {
                continue;
            };
            let Some((pid, title)) = window_identity(&dictionary) else {
                continue;
            };
            if let Some(browser) = matching_browser(browsers, pid, &title) {
                return Some(browser);
            }
        }
        None
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
mod platform {
    use crate::ProcessInfo;

    pub(super) fn meet_process(_browsers: &[ProcessInfo]) -> Option<ProcessInfo> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn browser(pid: Option<u32>, name: &str) -> ProcessInfo {
        ProcessInfo {
            pid,
            name: name.into(),
            executable: None,
            bundle_id: None,
        }
    }

    #[test]
    fn recognizes_only_meet_window_titles() {
        assert!(is_meet_title("Meet – Daily standup"));
        assert!(is_meet_title("Meet - Daily standup"));
        assert!(is_meet_title("  Google Meet  "));
        assert!(!is_meet_title("Google Meet - Google Chrome"));
        assert!(!is_meet_title("Inbox - Google Chrome"));
    }

    #[test]
    fn matches_only_a_supplied_browser_pid() {
        let browsers = [browser(Some(42), "chrome"), browser(None, "firefox")];
        assert_eq!(
            matching_browser(&browsers, 42, "Meet – Daily standup"),
            Some(browsers[0].clone())
        );
        assert_eq!(matching_browser(&browsers, 7, "Google Meet"), None);
        assert_eq!(matching_browser(&browsers, 42, "Inbox"), None);
    }

    #[test]
    fn audio_service_child_finds_its_browser_by_executable() {
        let mut child = browser(Some(4242), "browser.exe");
        child.executable = Some(r"C:\Users\me\AppData\Local\Yandex\YandexBrowser\Application\browser.exe".into());
        let browsers = [browser(Some(1), "chrome.exe"), child.clone()];
        assert_eq!(
            browser_with_executable(
                &browsers,
                r"c:\users\me\appdata\local\yandex\yandexbrowser\application\BROWSER.EXE"
            ),
            Some(child)
        );
        assert_eq!(browser_with_executable(&browsers, r"C:\Other\browser.exe"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn x11_property_parsers_reject_wrong_formats() {
        use x11rb::protocol::xproto::GetPropertyReply;

        let reply = GetPropertyReply {
            format: 8,
            sequence: 0,
            length: 0,
            type_: 0,
            bytes_after: 0,
            value_len: 1,
            value: vec![42],
        };
        assert_eq!(platform::first_cardinal(&reply), None);
        assert_eq!(platform::utf8_title(reply).as_deref(), Some("*"));
    }
}
