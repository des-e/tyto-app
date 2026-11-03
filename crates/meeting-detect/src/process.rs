use crate::{ProcessInfo, ProcessKind};

const ZOOM_BUNDLE_IDS: &[&str] = &["us.zoom.xos"];
const TEAMS_BUNDLE_IDS: &[&str] = &["com.microsoft.teams2", "com.microsoft.teams"];
const BROWSER_BUNDLE_IDS: &[&str] = &[
    "com.google.chrome",
    "com.google.chrome.beta",
    "com.google.chrome.dev",
    "com.google.chrome.canary",
    "com.microsoft.edgemac",
    "com.microsoft.edgemac.beta",
    "com.microsoft.edgemac.dev",
    "com.microsoft.edgemac.canary",
    "org.mozilla.firefox",
    "org.mozilla.firefoxdeveloperedition",
    "com.brave.browser",
    "com.brave.browser.beta",
    "com.brave.browser.dev",
    "com.brave.browser.nightly",
    "company.thebrowser.browser",
    // Other Chromium and Gecko browsers, from the list in fastrepl/anarlog (MIT) `crates/detect`.
    "org.chromium.chromium",
    "com.vivaldi.vivaldi",
    "com.operasoftware.opera",
    "com.operasoftware.operagx",
    "com.operasoftware.operanext",
    "com.operasoftware.operadeveloper",
    "company.thebrowser.dia",
    "ai.perplexity.comet",
    "app.zen-browser.zen",
    "org.mozilla.nightly",
    // Yandex Browser on mac: `/Applications/Yandex.app`, window owner «Yandex» (2026-11-03 probe).
    "ru.yandex.desktop.yandex-browser",
    "com.apple.safari",
];

const ZOOM_PROCESS_NAMES: &[&str] = &["zoom", "zoom.exe", "zoom.us", "zoom meetings"];
const TEAMS_PROCESS_NAMES: &[&str] = &[
    "teams",
    "teams.exe",
    "ms-teams",
    "ms-teams.exe",
    "msteams",
    "msteams.exe",
    "microsoft teams",
    "microsoft teams classic",
];
/// The Bitrix24 desktop app (Windows: `C:\Program Files (x86)\Bitrix24\Application\<ver>\Bitrix24.exe`,
/// 2026-11-02 probe). Its installer `bitrix24_desktop_ru.exe` is not it.
const BITRIX24_PROCESS_NAMES: &[&str] = &["bitrix24", "bitrix24.exe"];
const BROWSER_PROCESS_NAMES: &[&str] = &[
    "chrome",
    "chrome.exe",
    "google chrome",
    "google-chrome",
    "google-chrome-stable",
    "msedge",
    "msedge.exe",
    "microsoft edge",
    "microsoft-edge",
    "microsoft-edge-stable",
    "firefox",
    "firefox.exe",
    "mozilla firefox",
    "brave",
    "brave.exe",
    "brave browser",
    "brave-browser",
    "brave-browser-stable",
    "arc",
    "arc.exe",
    "vivaldi.exe",
    "opera.exe",
    // Yandex Browser on Windows. Only the `.exe` form: a bare `browser` is too generic elsewhere.
    "browser.exe",
    // Window owner names on mac, used to pick the window for a video recording.
    "yandex",
    "safari",
];

/// Safari, and every app built on WebKit (new Teams on mac too), captures the microphone in this
/// system service, whose parent is not the app. It stays unrecognised so the running-apps
/// fallback can still find Teams; only failing that does it mean Safari.
pub(crate) fn is_webkit_capture(process: &ProcessInfo) -> bool {
    normalize(&process.name) == "com.apple.webkit.gpu"
        || process
            .executable
            .as_deref()
            .is_some_and(|path| executable_name(path) == "com.apple.webkit.gpu")
}

pub(crate) fn is_safari(process: &ProcessInfo) -> bool {
    process.bundle_id.as_deref().map(normalize).as_deref() == Some("com.apple.safari") || normalize(&process.name) == "safari"
}

pub(crate) fn source(process: &ProcessInfo) -> Option<ProcessKind> {
    let bundle_id = process.bundle_id.as_deref().map(normalize);
    if bundle_id.as_deref().is_some_and(|id| ZOOM_BUNDLE_IDS.contains(&id)) {
        return Some(ProcessKind::Zoom);
    }
    if bundle_id.as_deref().is_some_and(|id| TEAMS_BUNDLE_IDS.contains(&id)) {
        return Some(ProcessKind::Teams);
    }
    // New Teams is an MSIX app. ConsentStore reports its package family rather than
    // `ms-teams.exe`, for example `MSTeams_8wekyb3d8bbwe`.
    if bundle_id
        .as_deref()
        .is_some_and(|id| id.starts_with("msteams_") && id.ends_with("_8wekyb3d8bbwe"))
    {
        return Some(ProcessKind::Teams);
    }
    if bundle_id.as_deref().is_some_and(|id| BROWSER_BUNDLE_IDS.contains(&id)) {
        return Some(ProcessKind::Browser);
    }

    let name = normalize(&process.name);
    let executable = process.executable.as_deref().map(executable_name);
    if exact_identity(&name, executable.as_deref(), ZOOM_PROCESS_NAMES) {
        return Some(ProcessKind::Zoom);
    }
    if exact_identity(&name, executable.as_deref(), TEAMS_PROCESS_NAMES) {
        return Some(ProcessKind::Teams);
    }
    if exact_identity(&name, executable.as_deref(), BITRIX24_PROCESS_NAMES) {
        return Some(ProcessKind::Bitrix24);
    }
    if exact_identity(&name, executable.as_deref(), BROWSER_PROCESS_NAMES) {
        return Some(ProcessKind::Browser);
    }
    None
}

fn normalize(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn executable_name(path: &str) -> String {
    normalize(path.rsplit(['/', '\\']).next().unwrap_or(path))
}

fn exact_identity(name: &str, executable: Option<&str>, candidates: &[&str]) -> bool {
    candidates.contains(&name) || executable.is_some_and(|value| candidates.contains(&value))
}

/// Known meeting candidates that are merely running. Used only when the OS mic API cannot name
/// the owner (macOS); other platforms normally classify the owner returned by `mic` directly.
pub(crate) fn running_candidates() -> Vec<ProcessInfo> {
    platform::running_candidates()
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
mod platform {
    use crate::ProcessInfo;
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    pub(super) fn running_candidates() -> Vec<ProcessInfo> {
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
        );
        system
            .processes()
            .values()
            .map(|process| ProcessInfo {
                pid: Some(process.pid().as_u32()),
                name: process.name().to_string_lossy().into_owned(),
                executable: process.exe().map(|path| path.to_string_lossy().into_owned()),
                bundle_id: None,
            })
            .filter(|process| super::source(process).is_some())
            .collect()
    }
}

#[cfg(target_os = "macos")]
pub(crate) use platform::application_info;

#[cfg(target_os = "macos")]
mod platform {
    use crate::ProcessInfo;
    use objc2::rc::{autoreleasepool, Retained};
    use objc2::ClassType;
    use objc2_app_kit::{NSRunningApplication, NSWorkspace};

    fn info(application: &NSRunningApplication) -> ProcessInfo {
        let executable = application
            .executableURL()
            .and_then(|url| url.path())
            .map(|path| path.to_string());
        let bundle_id = application.bundleIdentifier().map(|id| id.to_string());
        let name = application
            .localizedName()
            .map(|name| name.to_string())
            .or_else(|| {
                executable.as_deref().and_then(|path| {
                    std::path::Path::new(path)
                        .file_name()
                        .and_then(|name| name.to_str())
                        .map(str::to_owned)
                })
            })
            .or_else(|| bundle_id.clone())
            .unwrap_or_default();
        // The generated method is feature-gated on AppKit's optional `libc` feature;
        // the Objective-C ABI is still a plain signed process identifier.
        let raw_pid: i32 = unsafe { objc2::msg_send![application, processIdentifier] };
        ProcessInfo {
            pid: u32::try_from(raw_pid).ok().filter(|pid| *pid > 0),
            name,
            executable,
            bundle_id,
        }
    }

    /// The app behind `pid`, or `None` when it is not an app (a helper or command-line tool).
    pub(crate) fn application_info(pid: u32) -> Option<ProcessInfo> {
        let raw_pid = i32::try_from(pid).ok()?;
        autoreleasepool(|_| {
            // Same `libc` feature gate as `processIdentifier` above.
            let application: Option<Retained<NSRunningApplication>> =
                unsafe { objc2::msg_send![NSRunningApplication::class(), runningApplicationWithProcessIdentifier: raw_pid] };
            application.map(|application| info(&application))
        })
    }

    pub(super) fn running_candidates() -> Vec<ProcessInfo> {
        // `runningApplications` is explicitly thread-safe and returns an atomic snapshot, so the
        // detector's synchronous background poll does not need to hop to AppKit's main thread.
        // The explicit pool prevents autoreleased Cocoa objects accumulating across watch polls.
        autoreleasepool(|_| {
            let workspace = NSWorkspace::sharedWorkspace();
            workspace
                .runningApplications()
                .iter()
                .map(|application| info(&application))
                .filter(|info| super::source(info).is_some())
                .collect()
        })
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
mod platform {
    use crate::ProcessInfo;

    pub(super) fn running_candidates() -> Vec<ProcessInfo> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(name: &str, executable: Option<&str>, bundle_id: Option<&str>) -> ProcessInfo {
        ProcessInfo {
            pid: Some(42),
            name: name.into(),
            executable: executable.map(str::to_owned),
            bundle_id: bundle_id.map(str::to_owned),
        }
    }

    #[test]
    fn classifies_zoom_names_executables_and_bundle_id() {
        for (name, executable) in [
            ("zoom.exe", None),
            ("Zoom Meetings", None),
            ("ignored", Some(r"C:\Users\me\AppData\Roaming\Zoom\bin\Zoom.exe")),
            ("ignored", Some("/opt/zoom/zoom")),
            ("ignored", Some("/Applications/zoom.us.app/Contents/MacOS/zoom.us")),
        ] {
            assert_eq!(source(&process(name, executable, None)), Some(ProcessKind::Zoom));
        }
        assert_eq!(
            source(&process("Localized Zoom", None, Some("us.zoom.xos"))),
            Some(ProcessKind::Zoom)
        );
    }

    #[test]
    fn classifies_new_and_classic_teams_variants() {
        for (name, executable) in [
            ("Teams.exe", None),
            ("ms-teams", None),
            ("MSTeams.exe", None),
            ("Microsoft Teams", None),
            ("Microsoft Teams classic", None),
            ("ignored", Some(r"C:\Program Files\WindowsApps\MSTeams_1\ms-teams.exe")),
            ("ignored", Some("/usr/bin/teams")),
        ] {
            assert_eq!(source(&process(name, executable, None)), Some(ProcessKind::Teams));
        }
        for bundle_id in ["com.microsoft.teams2", "com.microsoft.teams", "MSTeams_8wekyb3d8bbwe"] {
            assert_eq!(
                source(&process("Localized Teams", None, Some(bundle_id))),
                Some(ProcessKind::Teams)
            );
        }
    }

    #[test]
    fn classifies_supported_browser_names_and_executables() {
        for (name, executable) in [
            ("Google Chrome", None),
            ("chrome.exe", None),
            ("ignored", Some("/usr/bin/google-chrome-stable")),
            ("Microsoft Edge", None),
            ("ignored", Some(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe")),
            ("Firefox", None),
            ("ignored", Some("/usr/lib/firefox/firefox")),
            ("Brave Browser", None),
            ("ignored", Some("/usr/bin/brave-browser")),
            ("Arc", None),
            ("ignored", Some(r"C:\Program Files\WindowsApps\TheBrowserCompany.Arc\Arc.exe")),
            ("browser.exe", None),
            (
                "ignored",
                Some(r"C:\Users\me\AppData\Local\Yandex\YandexBrowser\Application\browser.exe"),
            ),
        ] {
            assert_eq!(source(&process(name, executable, None)), Some(ProcessKind::Browser));
        }
    }

    #[test]
    fn classifies_stable_and_channel_browser_bundle_ids_exactly() {
        for bundle_id in BROWSER_BUNDLE_IDS {
            assert_eq!(
                source(&process("Localized Browser", None, Some(bundle_id))),
                Some(ProcessKind::Browser),
                "{bundle_id}"
            );
        }
    }

    #[test]
    fn bundle_identity_takes_priority_over_a_misleading_display_name() {
        assert_eq!(
            source(&process("Google Chrome", Some("chrome"), Some("us.zoom.xos"))),
            Some(ProcessKind::Zoom)
        );
        assert_eq!(
            source(&process("Zoom", Some("zoom"), Some("com.microsoft.teams2"))),
            Some(ProcessKind::Teams)
        );
    }

    #[test]
    fn rejects_helpers_substrings_and_paths_whose_directory_only_matches() {
        for candidate in [
            process("zoom-helperish", None, None),
            process("Zoom Helper", None, None),
            process("Teams Helper", None, None),
            process("chromedriver", None, None),
            process("Google Chrome Helper", None, None),
            process("Brave Browser Helper", None, None),
            process("arc-helper", None, None),
            process("notes about zoom.exe", None, None),
            process("Update", Some(r"C:\Users\me\AppData\Local\Microsoft\Teams\Update.exe"), None),
            process(
                "Google Chrome Helper",
                Some("/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper"),
                Some("com.google.Chrome.helper"),
            ),
        ] {
            assert_eq!(source(&candidate), None, "{candidate:?}");
        }
    }

    #[test]
    fn matching_is_ascii_case_insensitive_but_still_exact() {
        assert_eq!(source(&process("  GOOGLE CHROME  ", None, None)), Some(ProcessKind::Browser));
        assert_eq!(source(&process("Zoom.US", None, None)), Some(ProcessKind::Zoom));
        assert_eq!(source(&process("Teams.exe.old", None, None)), None);
        assert_eq!(source(&process("browser.company.thebrowser.browser", None, None)), None);
    }
}
