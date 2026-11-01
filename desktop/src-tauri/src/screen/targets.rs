//! What can be recorded: the window list for the picker and the OS floors for video.
// Used on Windows now; the macOS capture (Task 14) uses it too.
#![cfg_attr(not(windows), allow(dead_code))]

use super::commands::WindowTarget;
use super::encoder::TargetOs;

/// Smaller windows are tooltips, popups and the like.
const MIN_WINDOW_SIDE: u32 = 120;
/// Windows.Graphics.Capture for any window: Windows 10 1903.
const WINDOWS_MIN_BUILD: u32 = 18362;
/// ScreenCaptureKit with what Tyto needs: macOS 13.
const MACOS_MIN: (u32, u32) = (13, 0);

fn app_name(process_name: &str) -> String {
    let n = process_name.trim();
    match n.len().checked_sub(4) {
        Some(cut) if n.is_char_boundary(cut) && n[cut..].eq_ignore_ascii_case(".exe") => n[..cut].to_string(),
        _ => n.to_string(),
    }
}

/// Windows offered for recording: not Tyto's own (main window, pill, meeting
/// prompt), with a title, at least 120×120; sorted by program and title.
pub fn filter_windows(all: Vec<meeting_detect::WindowInfo>, own_pid: u32) -> Vec<WindowTarget> {
    let mut out: Vec<WindowTarget> = all
        .into_iter()
        .filter(|w| w.pid != own_pid)
        .filter(|w| !w.title.trim().is_empty())
        .filter(|w| w.width >= MIN_WINDOW_SIDE && w.height >= MIN_WINDOW_SIDE)
        .map(|w| WindowTarget {
            id: w.id.to_string(),
            title: w.title,
            app_name: app_name(&w.process_name),
        })
        .collect();
    out.sort_by_cached_key(|t| (t.app_name.to_lowercase(), t.title.to_lowercase()));
    out
}

/// Whether this OS version can record video (`version` = major, minor, build).
pub fn video_supported(os: TargetOs, version: (u32, u32, u32)) -> bool {
    match os {
        TargetOs::Windows => version.0 >= 10 && version.2 >= WINDOWS_MIN_BUILD,
        TargetOs::MacOs => (version.0, version.1) >= MACOS_MIN,
    }
}

/// `CurrentBuildNumber` from the registry (`None` if it can not be read).
#[cfg(windows)]
pub fn windows_build() -> Option<u32> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        .and_then(|key| key.get_value::<String, _>("CurrentBuildNumber"))
        .ok()
        .and_then(|build| build.trim().parse::<u32>().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_and_tiny_and_untitled_windows_are_not_offered() {
        let w = |pid, title: &str, w, h| meeting_detect::WindowInfo {
            id: 1,
            pid,
            title: title.into(),
            process_name: "x.exe".into(),
            width: w,
            height: h,
        };
        let out = filter_windows(
            vec![
                w(10, "Tyto", 800, 700),
                w(11, "", 800, 600),
                w(12, "Tooltip", 80, 30),
                w(13, "Телемост", 1280, 720),
            ],
            10,
        );
        assert_eq!(out.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), vec!["Телемост"]);
    }

    #[test]
    fn video_support_floors() {
        assert!(!video_supported(TargetOs::Windows, (10, 0, 17763)) && video_supported(TargetOs::Windows, (10, 0, 18362)));
        assert!(!video_supported(TargetOs::MacOs, (12, 7, 0)) && video_supported(TargetOs::MacOs, (13, 0, 0)));
    }

    #[test]
    fn windows_are_sorted_by_program_then_title_without_exe() {
        let w = |id, title: &str, exe: &str| meeting_detect::WindowInfo {
            id,
            pid: 5,
            title: title.into(),
            process_name: exe.into(),
            width: 500,
            height: 500,
        };
        let out = filter_windows(
            vec![w(1, "b", "Zoom.exe"), w(2, "Яндекс", "browser.EXE"), w(3, "a", "zoom.exe")],
            1,
        );
        let got: Vec<(&str, &str, &str)> = out
            .iter()
            .map(|t| (t.id.as_str(), t.app_name.as_str(), t.title.as_str()))
            .collect();
        assert_eq!(got, vec![("2", "browser", "Яндекс"), ("3", "zoom", "a"), ("1", "Zoom", "b")]);
    }
}
