//! Browser calls recognised by the address of the open tab rather than its title.
//!
//! The idea comes from fastrepl/anarlog (MIT, `crates/detect`): the title says little (Bitrix24 in a
//! browser is just «Мессенджер»), the address says which service it is. macOS reads it through the
//! Accessibility API (`AXWebArea` → `AXURL`, needs the «Универсальный доступ» permission, not Screen
//! Recording); Windows through UI Automation (the address bar is the first edit field of the
//! window, no permission needed).

use crate::{ProcessInfo, Source, WindowInfo};
use std::sync::Mutex;

/// Windows smaller than this are popups and helpers, not a browser window with a call.
const MIN_SIDE: u32 = 120;

/// The service an address belongs to. `url` may come without a scheme (the Windows address bar
/// shows `telemost.yandex.ru/j/…`).
pub(crate) fn url_source(url: &str) -> Option<Source> {
    let url = url.trim();
    let rest = match url.split_once("://") {
        Some((scheme, rest)) if scheme.eq_ignore_ascii_case("https") || scheme.eq_ignore_ascii_case("http") => rest,
        Some(_) => return None,
        None => url,
    };
    if rest.contains(char::is_whitespace) {
        // Search text typed into the address bar.
        return None;
    }
    let split = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, path) = rest.split_at(split);
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host).trim_end_matches('.').to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let path = path.to_ascii_lowercase();
    if host.is_empty() || !host.contains('.') {
        return None;
    }

    if host == "meet.google.com" {
        return Some(Source::Meet);
    }
    if is_telemost_host(host) {
        return Some(Source::Telemost);
    }
    // Cloud portals: `<name>.bitrix24.ru`, `.com`, `.by`, `.kz`, `.de` and so on. A call there runs
    // in the messenger or as a popup over any page, so every path counts.
    // The bitrix24.ru site itself (prices, help) is not a portal.
    let labels: Vec<&str> = host.split('.').collect();
    if labels
        .iter()
        .enumerate()
        .any(|(index, label)| *label == "bitrix24" && index > 0 && index + 1 < labels.len())
    {
        return Some(Source::Bitrix24);
    }
    // On-premise portals have their own domain; the video conference page is `/video/<code>`.
    if path.starts_with("/video/") {
        return Some(Source::Bitrix24);
    }
    None
}

fn is_telemost_host(host: &str) -> bool {
    matches!(host, "telemost.yandex.ru" | "telemost.yandex.com" | "telemost.360.yandex.ru" | "telemost.yandex.com.tr")
        || (host.starts_with("telemost.") && host.contains(".yandex."))
}

/// Where the last call found by address was, so the video recording can pick that window.
static LAST_CALL: Mutex<Option<(u32, Option<u64>, Source)>> = Mutex::new(None);

fn remember(pid: u32, window: Option<u64>, source: Source) {
    if let Ok(mut last) = LAST_CALL.lock() {
        *last = Some((pid, window, source));
    }
}

/// The window of the last call found by address for `source`: the same window if it is still on
/// screen, else the largest window of that browser process.
pub(crate) fn remembered_window(windows: &[WindowInfo], source: Source) -> Option<WindowInfo> {
    let (pid, id, remembered) = (*LAST_CALL.lock().ok()?)?;
    if remembered != source {
        return None;
    }
    let big = |w: &&WindowInfo| w.width >= MIN_SIDE && w.height >= MIN_SIDE;
    if let Some(found) = id.and_then(|id| windows.iter().filter(big).find(|w| w.id == id)) {
        return Some(found.clone());
    }
    windows
        .iter()
        .filter(big)
        .filter(|w| w.pid == pid)
        .max_by_key(|w| u64::from(w.width) * u64::from(w.height))
        .cloned()
}

fn file_name(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_ascii_lowercase()
}

/// Whether `window` belongs to one of `browsers`: the same pid (macOS, where the app owns its
/// windows), or the same executable (Windows, where the microphone sits in a child process).
fn belongs(window: &WindowInfo, browsers: &[ProcessInfo]) -> bool {
    let name = window.process_name.to_ascii_lowercase();
    browsers.iter().any(|browser| {
        browser.pid == Some(window.pid)
            || (!name.is_empty()
                && (browser.executable.as_deref().map(file_name).as_deref() == Some(name.as_str())
                    || browser.name.to_ascii_lowercase() == name))
    })
}

/// The browser windows worth reading, largest first.
fn candidate_windows(windows: &[WindowInfo], browsers: &[ProcessInfo]) -> Vec<WindowInfo> {
    let mut found: Vec<WindowInfo> = windows
        .iter()
        .filter(|w| w.width >= MIN_SIDE && w.height >= MIN_SIDE && belongs(w, browsers))
        .cloned()
        .collect();
    found.sort_by_key(|w| std::cmp::Reverse(u64::from(w.width) * u64::from(w.height)));
    found
}

/// A call open in one of `browsers`, found by the address of its tab.
pub(crate) fn call_by_url(browsers: &[ProcessInfo]) -> Option<Source> {
    if browsers.is_empty() || !platform::available() {
        return None;
    }
    let windows = candidate_windows(&crate::window_title::visible_windows(), browsers);
    for (pid, window, url) in platform::urls(&windows) {
        if let Some(source) = url_source(&url) {
            remember(pid, window, source);
            return Some(source);
        }
    }
    None
}

/// `pid | address` of every browser tab that could be read, for the opt-in probe.
pub(crate) fn probe_lines(windows: &[WindowInfo], owners: &[ProcessInfo]) -> Vec<String> {
    if !platform::available() {
        return vec!["(addresses unavailable: no Accessibility permission)".into()];
    }
    let browsers: Vec<ProcessInfo> = owners
        .iter()
        .filter(|info| crate::process::source(info) == Some(crate::ProcessKind::Browser))
        .cloned()
        .collect();
    let windows: Vec<WindowInfo> = windows
        .iter()
        .filter(|w| {
            w.width >= MIN_SIDE
                && w.height >= MIN_SIDE
                && (belongs(w, &browsers)
                    || crate::process::source(&ProcessInfo {
                        pid: Some(w.pid),
                        name: w.process_name.clone(),
                        executable: None,
                        bundle_id: None,
                    }) == Some(crate::ProcessKind::Browser))
        })
        .cloned()
        .collect();
    platform::urls(&windows)
        .into_iter()
        .map(|(pid, _, url)| format!("{pid} | {url}"))
        .collect()
}

/// Whether the OS lets Tyto read tab addresses (macOS: Accessibility; elsewhere always).
pub fn accessibility_granted() -> bool {
    platform::available()
}

/// Show the macOS prompt that adds Tyto to the Accessibility list. Returns the current answer.
pub fn request_accessibility() -> bool {
    platform::request()
}

#[cfg(target_os = "macos")]
mod platform {
    use crate::WindowInfo;
    use core_foundation::array::{CFArray, CFArrayRef};
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::{CFString, CFStringRef};
    use core_foundation::url::CFURL;
    use std::ffi::c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
        fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
        fn AXUIElementCopyAttributeValue(element: CFTypeRef, attribute: CFStringRef, value: *mut CFTypeRef) -> i32;
        fn AXUIElementSetMessagingTimeout(element: CFTypeRef, seconds: f32) -> i32;
    }

    /// A browser that stops answering must not stall the detector.
    const TIMEOUT_SECONDS: f32 = 0.3;
    const MAX_NODES: usize = 3000;
    const MAX_DEPTH: usize = 40;

    pub(super) fn available() -> bool {
        unsafe { AXIsProcessTrusted() != 0 }
    }

    pub(super) fn request() -> bool {
        let key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
        let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), CFBoolean::true_value().as_CFType())]);
        unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef().cast()) != 0 }
    }

    fn attribute(element: &CFType, name: &'static str) -> Option<CFType> {
        let key = CFString::from_static_string(name);
        let mut value: CFTypeRef = std::ptr::null();
        let status = unsafe { AXUIElementCopyAttributeValue(element.as_CFTypeRef(), key.as_concrete_TypeRef(), &mut value) };
        if status != 0 || value.is_null() {
            return None;
        }
        Some(unsafe { CFType::wrap_under_create_rule(value) })
    }

    fn elements(element: &CFType, name: &'static str) -> Vec<CFType> {
        let Some(value) = attribute(element, name) else {
            return Vec::new();
        };
        if value.type_of() != CFArray::<CFType>::type_id() {
            return Vec::new();
        }
        let array: CFArray<CFType> = unsafe { CFArray::wrap_under_get_rule(value.as_CFTypeRef() as CFArrayRef) };
        array.iter().map(|item| item.clone()).collect()
    }

    fn text(element: &CFType, name: &'static str) -> Option<String> {
        let value = attribute(element, name)?;
        // AXURL is a CFURL in some browsers and a CFString in others.
        if let Some(url) = value.downcast::<CFURL>() {
            return Some(url.get_string().to_string());
        }
        value.downcast::<CFString>().map(|s| s.to_string())
    }

    /// Addresses shown in one window: `AXDocument` of the window (Safari), then `AXURL` of every
    /// web area inside it (Chromium, Firefox). Page content below a web area is not walked.
    fn window_urls(window: &CFType, out: &mut Vec<String>) {
        if let Some(document) = text(window, "AXDocument").filter(|d| d.starts_with("http")) {
            out.push(document);
        }
        let mut stack = vec![(window.clone(), 0_usize)];
        let mut visited = 0;
        while let Some((element, depth)) = stack.pop() {
            visited += 1;
            if visited > MAX_NODES {
                break;
            }
            if text(&element, "AXRole").as_deref() == Some("AXWebArea") {
                if let Some(url) = text(&element, "AXURL") {
                    out.push(url);
                }
                continue;
            }
            if depth < MAX_DEPTH {
                stack.extend(elements(&element, "AXChildren").into_iter().map(|child| (child, depth + 1)));
            }
        }
    }

    /// `(pid, None, address)` for the windows of each browser process in `windows` (AX works per
    /// app, not per CGWindow, so the window id is not known).
    pub(super) fn urls(windows: &[WindowInfo]) -> Vec<(u32, Option<u64>, String)> {
        let mut pids: Vec<u32> = Vec::new();
        for window in windows {
            if !pids.contains(&window.pid) {
                pids.push(window.pid);
            }
        }
        let mut found = Vec::new();
        for pid in pids {
            let Ok(raw_pid) = i32::try_from(pid) else { continue };
            let app = unsafe { AXUIElementCreateApplication(raw_pid) };
            if app.is_null() {
                continue;
            }
            let app = unsafe { CFType::wrap_under_create_rule(app) };
            unsafe { AXUIElementSetMessagingTimeout(app.as_CFTypeRef(), TIMEOUT_SECONDS) };
            let mut addresses = Vec::new();
            for window in elements(&app, "AXWindows") {
                window_urls(&window, &mut addresses);
            }
            addresses.dedup();
            found.extend(addresses.into_iter().map(|url| (pid, None, url)));
        }
        found
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use crate::WindowInfo;
    use std::ffi::c_void;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationValuePattern, TreeScope_Descendants, UIA_ControlTypePropertyId,
        UIA_EditControlTypeId, UIA_ValuePatternId,
    };

    pub(super) fn available() -> bool {
        true
    }

    pub(super) fn request() -> bool {
        true
    }

    struct Com(bool);

    impl Com {
        fn enter() -> Self {
            Self(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
        }
    }

    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    /// The text of the window's first edit field: the address bar in Chromium browsers.
    fn address_bar(automation: &IUIAutomation, window: u64) -> Option<String> {
        let hwnd = HWND(window as usize as *mut c_void);
        let element = unsafe { automation.ElementFromHandle(hwnd) }.ok()?;
        let edit_type = VARIANT::from(UIA_EditControlTypeId.0);
        let condition = unsafe { automation.CreatePropertyCondition(UIA_ControlTypePropertyId, &edit_type) }.ok()?;
        let edit = unsafe { element.FindFirst(TreeScope_Descendants, &condition) }.ok()?;
        let pattern: IUIAutomationValuePattern = unsafe { edit.GetCurrentPatternAs(UIA_ValuePatternId) }.ok()?;
        let value = unsafe { pattern.CurrentValue() }.ok()?.to_string();
        let value = value.trim().to_owned();
        (!value.is_empty()).then_some(value)
    }

    pub(super) fn urls(windows: &[WindowInfo]) -> Vec<(u32, Option<u64>, String)> {
        if windows.is_empty() {
            return Vec::new();
        }
        let _com = Com::enter();
        let automation: IUIAutomation = match unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) } {
            Ok(automation) => automation,
            Err(_) => return Vec::new(),
        };
        windows
            .iter()
            .filter_map(|window| address_bar(&automation, window.id).map(|url| (window.pid, Some(window.id), url)))
            .collect()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use crate::WindowInfo;

    pub(super) fn available() -> bool {
        false
    }

    pub(super) fn request() -> bool {
        false
    }

    pub(super) fn urls(_windows: &[WindowInfo]) -> Vec<(u32, Option<u64>, String)> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn services_by_address() {
        for (url, source) in [
            ("https://meet.google.com/abc-defg-hij", Some(Source::Meet)),
            ("meet.google.com/abc-defg-hij", Some(Source::Meet)),
            ("https://telemost.yandex.ru/j/12345678901234", Some(Source::Telemost)),
            ("telemost.360.yandex.ru/j/1", Some(Source::Telemost)),
            ("https://excode.bitrix24.ru/online/?IM_DIALOG=chat12", Some(Source::Bitrix24)),
            ("https://portal.bitrix24.by/", Some(Source::Bitrix24)),
            ("https://crm.example.ru/video/Ab3dE9fG", Some(Source::Bitrix24)),
            ("https://www.bitrix24.ru/prices/", None),
            ("https://www.google.com/search?q=meet.google.com", None),
            ("https://bitrix24.example.com/", None),
            ("https://yandex.ru/telemost", None),
            ("chrome://settings", None),
            ("about:blank", None),
            ("telemost yandex", None),
            ("", None),
        ] {
            assert_eq!(url_source(url), source, "{url}");
        }
    }

    fn window(id: u64, pid: u32, name: &str, width: u32, height: u32) -> WindowInfo {
        WindowInfo {
            id,
            pid,
            title: String::new(),
            process_name: name.into(),
            width,
            height,
        }
    }

    fn browser(pid: u32, name: &str, executable: Option<&str>) -> ProcessInfo {
        ProcessInfo {
            pid: Some(pid),
            name: name.into(),
            executable: executable.map(str::to_owned),
            bundle_id: None,
        }
    }

    #[test]
    fn browser_windows_by_pid_or_executable_largest_first() {
        let windows = [
            window(1, 732, "Yandex", 1728, 1084),
            window(2, 732, "Yandex", 80, 40),
            window(3, 900, "browser.exe", 1200, 800),
            window(4, 901, "Telegram.exe", 1600, 900),
            window(5, 902, "browser.exe", 1900, 1000),
        ];
        // mac: the mic owner's parent app owns the windows.
        let mac = candidate_windows(&windows, &[browser(732, "Yandex", Some("/Applications/Yandex.app/Contents/MacOS/Yandex"))]);
        assert_eq!(mac.iter().map(|w| w.id).collect::<Vec<_>>(), vec![1]);
        // Windows: the mic sits in a utility child; its windows are the same executable.
        let win = candidate_windows(
            &windows,
            &[browser(4242, "browser.exe", Some(r"C:\Users\me\AppData\Local\Yandex\YandexBrowser\Application\browser.exe"))],
        );
        assert_eq!(win.iter().map(|w| w.id).collect::<Vec<_>>(), vec![5, 3]);
    }

    #[test]
    fn remembered_window_is_the_same_one_or_the_largest_of_that_browser() {
        let windows = [window(10, 732, "Yandex", 1728, 1084), window(11, 732, "Yandex", 800, 600), window(12, 5, "Finder", 2000, 1200)];
        remember(732, Some(11), Source::Bitrix24);
        assert_eq!(remembered_window(&windows, Source::Bitrix24).map(|w| w.id), Some(11));
        assert_eq!(remembered_window(&windows, Source::Telemost), None);
        remember(732, None, Source::Telemost);
        assert_eq!(remembered_window(&windows, Source::Telemost).map(|w| w.id), Some(10));
    }
}
