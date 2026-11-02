//! Detect whether a known meeting application currently owns the microphone.
//!
//! This crate intentionally contains no UI, recording, async runtime, or Tauri integration.

mod mic;
mod process;
mod window_title;

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// A meeting that has just started should surface almost immediately, so a new recording state
/// only has to survive a couple of polls.
const DEFAULT_ONSET_DEBOUNCE: Duration = Duration::from_millis(400);
/// The microphone being closed outright ends the call unambiguously, so it is confirmed almost as
/// quickly as it is reported.
const DEFAULT_RELEASE_DEBOUNCE: Duration = Duration::from_millis(600);
/// Losing only the *attribution* while the microphone stays open is debounced far harder: a brief
/// hand-off inside a call must not tear the prompt down and put it back up.
const DEFAULT_ATTRIBUTION_DEBOUNCE: Duration = Duration::from_secs(5);
const MIN_INTERVAL: Duration = Duration::from_millis(50);
/// While the signal is still settling the poll rate is raised so the debounce, not the cadence,
/// decides how quickly a meeting is reported.
const UNSETTLED_INTERVAL: Duration = Duration::from_millis(150);
/// Enumerating on-screen windows to read browser titles costs milliseconds, far more than the rest
/// of a poll. While the state is settled it is rate-limited to this interval instead of running on
/// every poll; a pending change still scans at the full cadence.
const TITLE_SCAN_INTERVAL: Duration = Duration::from_millis(1000);

/// A supported meeting source.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Zoom,
    Teams,
    Meet,
    /// Yandex Telemost in a browser tab.
    Telemost,
    /// The Bitrix24 desktop app, only while it holds the microphone itself.
    Bitrix24,
}

impl Source {
    /// Recognised from a browser tab title, so the attribution is held when the tab is switched.
    fn is_browser_tab(self) -> bool {
        matches!(self, Source::Meet | Source::Telemost)
    }
}

/// One snapshot of the current meeting signal.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct MeetingState {
    pub recording: bool,
    pub source: Option<Source>,
}

impl MeetingState {
    fn inactive() -> Self {
        Self {
            recording: false,
            source: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProcessKind {
    Zoom,
    Teams,
    Bitrix24,
    Browser,
}

/// Process identity shared by the platform-specific signal and title layers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProcessInfo {
    pub(crate) pid: Option<u32>,
    pub(crate) name: String,
    pub(crate) executable: Option<String>,
    pub(crate) bundle_id: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct MicUsage {
    pub(crate) active: bool,
    /// Empty when the OS exposes microphone activity but not its owner (older macOS).
    pub(crate) processes: Vec<ProcessInfo>,
    /// Whether the OS could name the microphone owners at all. On macOS this is true only when the
    /// CoreAudio process list (macOS 14.2+) answered.
    pub(crate) owners_known: bool,
}

/// One top-level on-screen window, as the OS reports it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct WindowInfo {
    /// `HWND` on Windows, `CGWindowID` on macOS.
    pub id: u64,
    pub pid: u32,
    /// May be empty: windows without a title are returned too, the consumer filters.
    pub title: String,
    pub process_name: String,
    pub width: u32,
    pub height: u32,
}

/// Visible top-level windows of every process (Windows and macOS; empty elsewhere).
///
/// Window titles are personal data: callers must not log them unless the user opted in.
pub fn visible_windows() -> Vec<WindowInfo> {
    window_title::visible_windows()
}

/// A raw snapshot used to learn how new meeting apps look to the OS.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ProbeReport {
    pub mic_active: bool,
    /// Whether the OS named the microphone owners. Meaningful only when `mic_active`: while the
    /// microphone is idle macOS reports `false` and Windows / Linux `true`.
    pub owners_known: bool,
    /// `name | exe | bundle_id` of every microphone owner, known meeting app or not.
    pub mic_owners: Vec<String>,
    /// Empty while the microphone is idle: the windows are only enumerated when it is in use.
    pub windows: Vec<WindowInfo>,
}

/// Read the microphone owners and, while the microphone is in use, the visible windows.
pub fn probe() -> ProbeReport {
    let usage = mic::current_usage();
    ProbeReport {
        mic_active: usage.active,
        owners_known: usage.owners_known,
        mic_owners: usage.processes.iter().map(owner_line).collect(),
        windows: if usage.active { visible_windows() } else { Vec::new() },
    }
}

fn owner_line(info: &ProcessInfo) -> String {
    format!(
        "{} | {} | {}",
        info.name,
        info.executable.as_deref().unwrap_or("-"),
        info.bundle_id.as_deref().unwrap_or("-")
    )
}

/// Whether the OS lets this app read other windows' titles — how a browser meeting is recognised.
///
/// Only macOS gates this, behind Screen Recording. Zoom and Teams are found through the process
/// list instead, so they keep working either way; it is Google Meet that goes quiet without it.
pub fn screen_recording_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        window_title::screen_recording_granted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Ask the OS for that permission, showing its prompt the first time.
pub fn request_screen_recording() -> bool {
    #[cfg(target_os = "macos")]
    {
        window_title::request_screen_recording()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Perform one synchronous poll.
pub fn detect() -> MeetingState {
    poll(true).state
}

#[derive(Clone, Debug)]
struct DetectionSnapshot {
    state: MeetingState,
    mic_active: bool,
    /// Whether a browser that could be hosting Meet is still running and a microphone candidate.
    browser_present: bool,
}

/// `scan_titles` enables the browser window-title lookup that identifies Meet. Callers that already
/// know the answer, or that are willing to wait for the next scan, pass `false` to skip the most
/// expensive part of a poll.
fn poll(scan_titles: bool) -> DetectionSnapshot {
    let usage = mic::current_usage();
    if !usage.active {
        return DetectionSnapshot {
            state: MeetingState::inactive(),
            mic_active: false,
            browser_present: false,
        };
    }

    let (processes, owners) = candidates_with_origin(usage.processes, cfg!(target_os = "macos"), process::running_candidates);
    let browser_present = processes
        .iter()
        .any(|info| process::source(info) == Some(ProcessKind::Browser));
    DetectionSnapshot {
        state: classify_active(processes, scan_titles, owners),
        mic_active: true,
        browser_present,
    }
}

/// The processes a poll classifies: the microphone owners, or the running known apps instead.
///
/// No owners at all (older macOS) always falls back. On macOS the owners come from the CoreAudio
/// process list, where a capture can sit in a service whose app the parent walk cannot reach, so
/// unrecognised owners fall back as well: detection is never worse than before that list was
/// used. Windows and Linux name the owner reliably, and an unrecognised owner there means "not a
/// meeting", so the running Zoom or Teams must not be blamed for it.
#[cfg(test)]
fn candidates(
    owners: Vec<ProcessInfo>,
    fallback_when_unrecognised: bool,
    running: impl FnOnce() -> Vec<ProcessInfo>,
) -> Vec<ProcessInfo> {
    candidates_with_origin(owners, fallback_when_unrecognised, running).0
}

/// `candidates`, plus whether the list is the microphone owners themselves (`true`) or the running
/// apps it fell back to (`false`).
fn candidates_with_origin(
    owners: Vec<ProcessInfo>,
    fallback_when_unrecognised: bool,
    running: impl FnOnce() -> Vec<ProcessInfo>,
) -> (Vec<ProcessInfo>, bool) {
    let recognised = owners.iter().any(|info| process::source(info).is_some());
    if owners.is_empty() || (fallback_when_unrecognised && !recognised) {
        (running(), false)
    } else {
        (owners, true)
    }
}

/// `owners`: the processes are the microphone owners, not running apps it fell back to. Bitrix24
/// counts only then: its messenger is open all day, so merely running says nothing about a call.
fn classify_active(processes: Vec<ProcessInfo>, scan_titles: bool, owners: bool) -> MeetingState {
    if processes.is_empty() {
        return MeetingState::inactive();
    }

    if processes.iter().any(|info| process::source(info) == Some(ProcessKind::Zoom)) {
        return attributed(Source::Zoom);
    }
    if processes.iter().any(|info| process::source(info) == Some(ProcessKind::Teams)) {
        return attributed(Source::Teams);
    }
    if owners
        && processes
            .iter()
            .any(|info| process::source(info) == Some(ProcessKind::Bitrix24))
    {
        return attributed(Source::Bitrix24);
    }

    if !scan_titles {
        return MeetingState::inactive();
    }

    let browsers: Vec<_> = processes
        .iter()
        .filter(|info| process::source(info) == Some(ProcessKind::Browser))
        .cloned()
        .collect();
    if let Some((_, source)) = (!browsers.is_empty()).then(|| window_title::call_tab(&browsers)).flatten() {
        return attributed(source);
    }

    MeetingState::inactive()
}

fn attributed(source: Source) -> MeetingState {
    MeetingState {
        recording: true,
        source: Some(source),
    }
}

/// A cancellable microphone watcher. Dropping it stops and joins its worker promptly.
pub struct Watcher {
    receiver: Receiver<MeetingState>,
    cancel: Sender<()>,
    worker: Option<JoinHandle<()>>,
}

impl Watcher {
    pub fn recv_timeout(&self, timeout: Duration) -> Result<MeetingState, RecvTimeoutError> {
        self.receiver.recv_timeout(timeout)
    }

    pub fn stop(mut self) {
        self.stop_inner();
    }

    fn stop_inner(&mut self) {
        let _ = self.cancel.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Iterator for Watcher {
    type Item = MeetingState;

    fn next(&mut self) -> Option<Self::Item> {
        self.receiver.recv().ok()
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.stop_inner();
    }
}

/// How long a change must persist before it is emitted, per direction.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Debounce {
    /// Applied to any change that reports a meeting.
    onset: Duration,
    /// Applied to losing a meeting because the microphone was closed.
    release: Duration,
    /// Applied to losing a meeting while the microphone stays open.
    attribution: Duration,
}

impl Debounce {
    fn for_change(&self, next: &MeetingState, mic_active: bool) -> Duration {
        match (next.recording, mic_active) {
            (true, _) => self.onset,
            (false, false) => self.release,
            (false, true) => self.attribution,
        }
    }
}

impl Default for Debounce {
    fn default() -> Self {
        Self {
            onset: DEFAULT_ONSET_DEBOUNCE,
            release: DEFAULT_RELEASE_DEBOUNCE,
            attribution: DEFAULT_ATTRIBUTION_DEBOUNCE,
        }
    }
}

/// Poll on a background thread and emit only stable state changes.
///
/// A new meeting only has to survive a few hundred milliseconds, and so does the microphone being
/// closed — quitting the call clears the state promptly. Only losing the attribution *while* the
/// microphone stays open is held for roughly five seconds. Polling speeds up on its own while the
/// signal is unsettled, so `interval` is the idle cadence rather than the detection latency. Once
/// Meet is confirmed, transient title loss does not downgrade it while the same browser keeps the
/// microphone session open.
pub fn watch(interval: Duration) -> Watcher {
    watch_with(interval, Debounce::default(), poll)
}

fn watch_with<F>(interval: Duration, debounce: Debounce, mut poll: F) -> Watcher
where
    F: FnMut(bool) -> DetectionSnapshot + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();
    let (cancel, cancellation) = mpsc::channel();
    let worker = thread::spawn(move || {
        let interval = interval.max(MIN_INTERVAL);
        let unsettled_interval = UNSETTLED_INTERVAL.max(MIN_INTERVAL).min(interval);
        let mut emitted: Option<MeetingState> = None;
        let mut mic_active = false;
        let mut candidate: Option<(MeetingState, Instant)> = None;
        // Set only when a browser-tab state (Meet, Telemost) is actually emitted. A one-poll title
        // match must pass the debounce before it earns the sticky behavior.
        let mut held_tab: Option<Source> = None;
        let mut last_title_scan: Option<Instant> = None;
        // The first poll always scans, and so does any poll taken while the signal is in motion.
        let mut unsettled = true;

        loop {
            // Skipping the window scan while Meet is held costs nothing: the hold below overrides
            // whatever the scan would have returned for the rest of this microphone session.
            let scan_titles = held_tab.is_none()
                && (unsettled || last_title_scan.is_none_or(|scanned| scanned.elapsed() >= TITLE_SCAN_INTERVAL));
            let snapshot = poll(scan_titles);
            if scan_titles {
                last_title_scan = Some(Instant::now());
            }
            // The microphone opening or closing is the leading edge of every change worth
            // reporting, so keep polling fast until the state that follows it has been emitted.
            let mic_changed = snapshot.mic_active != mic_active;
            mic_active = snapshot.mic_active;
            let mut next = snapshot.state;
            // A browser can stop exposing the Meet title as soon as the user switches tabs. Once
            // Meet has survived the debounce, retain that attribution until the mic is released or
            // the browser itself goes away — quitting the browser must not strand the prompt.
            if let Some(source) = held_tab.filter(|_| snapshot.mic_active && snapshot.browser_present) {
                next = attributed(source);
            }

            if !snapshot.mic_active || !snapshot.browser_present {
                held_tab = None;
            }

            if emitted.is_none() {
                if sender.send(next.clone()).is_err() {
                    break;
                }
                update_tab_hold(&next, &mut held_tab);
                emitted = Some(next);
                candidate = None;
            } else if emitted.as_ref() == Some(&next) {
                candidate = None;
            } else {
                match &mut candidate {
                    Some((pending, since)) if *pending == next => {
                        if since.elapsed() >= debounce.for_change(&next, snapshot.mic_active) {
                            if sender.send(next.clone()).is_err() {
                                break;
                            }
                            update_tab_hold(&next, &mut held_tab);
                            emitted = Some(next);
                            candidate = None;
                        }
                    }
                    slot => *slot = Some((next, Instant::now())),
                }
            }

            unsettled = candidate.is_some() || mic_changed;
            let wait = if unsettled { unsettled_interval } else { interval };
            match cancellation.recv_timeout(wait) {
                Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    });
    Watcher {
        receiver,
        cancel,
        worker: Some(worker),
    }
}

fn update_tab_hold(state: &MeetingState, held_tab: &mut Option<Source>) {
    if !state.recording {
        *held_tab = None;
    } else if let Some(source) = state.source.filter(|s| s.is_browser_tab()) {
        *held_tab = Some(source);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    fn debounce(onset_ms: u64, loss_ms: u64) -> Debounce {
        Debounce {
            onset: Duration::from_millis(onset_ms),
            release: Duration::from_millis(loss_ms),
            attribution: Duration::from_millis(loss_ms),
        }
    }

    fn snapshot(state: MeetingState, mic_active: bool) -> DetectionSnapshot {
        DetectionSnapshot {
            browser_present: mic_active,
            state,
            mic_active,
        }
    }

    fn process(name: &str) -> ProcessInfo {
        ProcessInfo {
            pid: Some(1),
            name: name.to_string(),
            executable: None,
            bundle_id: None,
        }
    }

    #[test]
    fn probe_report_serializes_owner_and_window_lists() {
        let report = ProbeReport {
            mic_active: true,
            owners_known: true,
            mic_owners: vec!["telemost.exe | C:\\x\\telemost.exe | -".into()],
            windows: vec![WindowInfo {
                id: 7,
                pid: 42,
                title: "Встреча".into(),
                process_name: "telemost.exe".into(),
                width: 800,
                height: 600,
            }],
        };
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("\"owners_known\":true") && json.contains("Встреча"));
    }

    #[test]
    fn recognised_owners_are_classified_as_reported() {
        let owners = vec![process("Google Chrome Helper"), process("zoom")];
        let used = candidates(owners.clone(), true, || panic!("must not fall back"));
        assert_eq!(used, owners);
    }

    #[test]
    fn missing_owners_always_fall_back_to_running_apps() {
        for fallback_when_unrecognised in [false, true] {
            assert_eq!(
                candidates(Vec::new(), fallback_when_unrecognised, || vec![process("zoom")]),
                vec![process("zoom")]
            );
        }
    }

    #[test]
    fn unrecognised_owners_fall_back_only_where_asked() {
        let owners = vec![process("com.apple.WebKit.GPU")];
        // macOS: an owner the parent walk could not attribute must not hide a running meeting app.
        assert_eq!(
            candidates(owners.clone(), true, || vec![process("ms-teams")]),
            vec![process("ms-teams")]
        );
        // Windows / Linux: a named non-meeting owner is the answer, not a reason to blame Teams.
        assert_eq!(candidates(owners.clone(), false, || vec![process("ms-teams")]), owners);
    }

    #[test]
    fn owner_line_marks_missing_fields() {
        let mut info = process("Telemost");
        assert_eq!(owner_line(&info), "Telemost | - | -");
        info.executable = Some("/Applications/Telemost.app/Contents/MacOS/Telemost".into());
        info.bundle_id = Some("ru.yandex.telemost".into());
        assert_eq!(
            owner_line(&info),
            "Telemost | /Applications/Telemost.app/Contents/MacOS/Telemost | ru.yandex.telemost"
        );
    }

    #[test]
    fn zoom_and_teams_take_priority_over_browser_fallback() {
        assert_eq!(
            classify_active(vec![process("chrome"), process("zoom")], true, true).source,
            Some(Source::Zoom)
        );
        assert_eq!(
            classify_active(vec![process("firefox"), process("ms-teams")], true, true).source,
            Some(Source::Teams)
        );
    }

    /// 2026-11-02 probe: during a call `Bitrix24.exe` itself owns the microphone; idle, it does not.
    #[test]
    fn bitrix_desktop_counts_only_when_it_owns_the_microphone() {
        assert_eq!(
            classify_active(vec![process("Bitrix24.exe")], false, true).source,
            Some(Source::Bitrix24)
        );
        // the running app the detector fell back to (owner unknown): open all day, not a call
        assert!(!classify_active(vec![process("Bitrix24.exe")], false, false).recording);
        // the installer is not the app
        assert!(!classify_active(vec![process("bitrix24_desktop_ru.exe")], false, true).recording);
    }

    #[test]
    fn zoom_still_beats_a_running_bitrix() {
        assert_eq!(
            classify_active(vec![process("Bitrix24.exe"), process("zoom")], false, true).source,
            Some(Source::Zoom)
        );
    }

    /// The fallback list is marked so Bitrix24 is not blamed for a microphone it may not hold.
    #[test]
    fn candidates_say_whether_they_are_the_owners() {
        let owners = vec![process("Bitrix24.exe")];
        assert_eq!(candidates_with_origin(owners.clone(), false, Vec::new), (owners, true));
        assert_eq!(
            candidates_with_origin(Vec::new(), false, || vec![process("Bitrix24.exe")]),
            (vec![process("Bitrix24.exe")], false)
        );
    }

    #[test]
    fn browser_tab_attribution_is_held_for_meet_and_telemost_only() {
        let mut held = None;
        update_tab_hold(&attributed(Source::Telemost), &mut held);
        assert_eq!(held, Some(Source::Telemost));
        update_tab_hold(&attributed(Source::Bitrix24), &mut held);
        assert_eq!(held, Some(Source::Telemost));
        update_tab_hold(&MeetingState::inactive(), &mut held);
        assert_eq!(held, None);
        update_tab_hold(&attributed(Source::Meet), &mut held);
        assert_eq!(held, Some(Source::Meet));
    }

    #[test]
    fn new_sources_serialize_for_the_frontend() {
        assert_eq!(serde_json::to_string(&Source::Telemost).unwrap(), "\"telemost\"");
        assert_eq!(serde_json::to_string(&Source::Bitrix24).unwrap(), "\"bitrix24\"");
    }

    #[test]
    fn ordinary_browser_microphone_use_is_not_a_meeting() {
        let state = classify_active(vec![process("chrome")], true, true);
        assert!(!state.recording);
        assert_eq!(state.source, None);
    }

    #[test]
    fn watcher_emits_initial_state_and_stable_changes() {
        let inactive = MeetingState::inactive();
        let active = MeetingState {
            recording: true,
            source: Some(Source::Zoom),
        };
        let mut states = VecDeque::from([
            snapshot(inactive.clone(), false),
            snapshot(active.clone(), true),
            snapshot(active.clone(), true),
            snapshot(active.clone(), true),
        ]);
        let receiver = watch_with(Duration::from_millis(1), debounce(150, 150), move |_| {
            states.pop_front().unwrap_or_else(|| snapshot(active.clone(), true))
        });

        assert_eq!(receiver.recv_timeout(Duration::from_secs(1)).unwrap(), inactive);
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(1)).unwrap().source,
            Some(Source::Zoom)
        );
    }

    #[test]
    fn watcher_holds_confirmed_meet_until_mic_release() {
        let meet = MeetingState {
            recording: true,
            source: Some(Source::Meet),
        };
        let inactive = MeetingState::inactive();
        let mut states = VecDeque::from([
            snapshot(meet.clone(), true),
            snapshot(inactive.clone(), true),
            snapshot(inactive.clone(), true),
            snapshot(inactive.clone(), false),
            snapshot(inactive.clone(), false),
            snapshot(inactive.clone(), false),
        ]);
        let receiver = watch_with(Duration::from_millis(1), debounce(150, 150), move |_| {
            states
                .pop_front()
                .unwrap_or_else(|| snapshot(MeetingState::inactive(), false))
        });

        assert_eq!(receiver.recv_timeout(Duration::from_secs(1)).unwrap(), meet);
        // Browser title loss is suppressed; the next emitted state is the stable mic release.
        assert!(!receiver.recv_timeout(Duration::from_secs(1)).unwrap().recording);
    }

    #[test]
    fn a_new_meeting_is_emitted_far_sooner_than_a_lost_one() {
        let active = MeetingState {
            recording: true,
            source: Some(Source::Zoom),
        };
        let watcher = watch_with(Duration::from_millis(1), debounce(50, 10_000), {
            let active = active.clone();
            let mut polls = 0_u32;
            move |_| {
                polls += 1;
                // Inactive once, then a meeting that never goes away.
                snapshot(
                    if polls == 1 {
                        MeetingState::inactive()
                    } else {
                        active.clone()
                    },
                    polls > 1,
                )
            }
        });

        assert!(!watcher.recv_timeout(Duration::from_secs(1)).unwrap().recording);
        let started = Instant::now();
        assert_eq!(watcher.recv_timeout(Duration::from_secs(1)).unwrap(), active);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn closing_the_microphone_clears_the_meeting_without_the_attribution_debounce() {
        let active = MeetingState {
            recording: true,
            source: Some(Source::Zoom),
        };
        let debounce = Debounce {
            onset: Duration::from_millis(10),
            release: Duration::from_millis(50),
            attribution: Duration::from_secs(30),
        };
        let watcher = watch_with(Duration::from_millis(1), debounce, {
            let active = active.clone();
            let mut polls = 0_u32;
            // In a call, then the user quits it and the mic closes for good.
            move |_| match polls {
                0..=3 => {
                    polls += 1;
                    snapshot(active.clone(), true)
                }
                _ => snapshot(MeetingState::inactive(), false),
            }
        });

        assert_eq!(watcher.recv_timeout(Duration::from_secs(1)).unwrap(), active);
        let started = Instant::now();
        assert!(!watcher.recv_timeout(Duration::from_secs(1)).unwrap().recording);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn quitting_the_browser_drops_a_held_meet_attribution() {
        let meet = MeetingState {
            recording: true,
            source: Some(Source::Meet),
        };
        let mut polls = 0_u32;
        let watcher = watch_with(Duration::from_millis(1), debounce(10, 50), {
            let meet = meet.clone();
            move |_| {
                polls += 1;
                // Meet is confirmed, then the browser quits while another app keeps the mic open.
                DetectionSnapshot {
                    state: if polls <= 3 { meet.clone() } else { MeetingState::inactive() },
                    mic_active: true,
                    browser_present: polls <= 3,
                }
            }
        });

        assert_eq!(watcher.recv_timeout(Duration::from_secs(1)).unwrap(), meet);
        assert!(!watcher.recv_timeout(Duration::from_secs(1)).unwrap().recording);
    }

    #[test]
    fn a_held_meet_stops_paying_for_the_window_scan() {
        use std::sync::{Arc, Mutex};

        let meet = MeetingState {
            recording: true,
            source: Some(Source::Meet),
        };
        let scans: Arc<Mutex<Vec<bool>>> = Arc::default();
        let watcher = watch_with(Duration::from_millis(1), debounce(10, 50), {
            let meet = meet.clone();
            let scans = Arc::clone(&scans);
            move |scan_titles| {
                scans.lock().unwrap().push(scan_titles);
                snapshot(meet.clone(), true)
            }
        });

        assert_eq!(watcher.recv_timeout(Duration::from_secs(1)).unwrap(), meet);
        // Let the watcher settle into the held state before sampling the requests.
        thread::sleep(Duration::from_millis(120));
        let taken = scans.lock().unwrap().len();
        thread::sleep(Duration::from_millis(120));
        let scans = scans.lock().unwrap();
        assert!(scans.len() > taken, "the watcher kept polling");
        assert!(scans[0], "the first poll must scan");
        assert!(
            scans[taken..].iter().all(|scanned| !scanned),
            "a held Meet must not keep scanning windows: {scans:?}"
        );
    }

    #[test]
    fn dropping_watcher_interrupts_a_long_poll_interval() {
        let started = Instant::now();
        let watcher = watch_with(Duration::from_secs(30), debounce(1000, 1000), |_| {
            snapshot(MeetingState::inactive(), false)
        });
        watcher.recv_timeout(Duration::from_secs(1)).unwrap();
        drop(watcher);
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
