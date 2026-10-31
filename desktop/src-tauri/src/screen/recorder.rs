//! Recording runtime: devices, segments, rotation, the disk watch and saving.
//!
//! Every file goes straight into `<Записи>/.tyto-rec-<time>/` (never the temp
//! folder that `cleaner.rs` empties). One `SegmentedWavSink` per selected source;
//! the device callback writes into it with `try_lock`, so a callback that meets a
//! rotation drops one buffer and the sink pads the hole with silence. A segment
//! is closed on pause, every `SEGMENT_MAX`, when a sink fails, and on stop.
//!
//! Save order (see `recovery`): `SessionLock` from the start → `finalizing_to`
//! → mux into `final.partial.<ext>` → `record_final_bytes` → rename → drop the
//! lock → `remove_working_dir`. A failed mux keeps the working folder.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command as Process, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use eyre::{bail, Context, ContextCompat, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::audio_sink::SegmentedWavSink;
use super::disk;
use super::encoder::VideoEncoder;
use super::quality::{preset, Quality};
use super::recovery::{discard_unfinished, record_final_bytes, remove_working_dir, SessionLock};
use super::segments::{
    finalize_args, finalize_plan, read_manifest, segment_file, write_concat_lists, write_manifest_atomic, AudioSource,
    FinalizeError, FinalizePlan, Manifest, SegmentRecord, MANIFEST_VERSION, SEGMENT_MAX, SESSION_PREFIX,
};
use super::session::{transition, Command, Mode, RecordingStatePayload, SessionError, Status, Timeline};
use crate::cmd::audio::{build_capture_stream, get_output_device_and_config, AudioDevice, LevelMeter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub const STATE_EVENT: &str = "recording_state";
pub const FINISHED_EVENT: &str = "recording_finished";
pub const FAILED_EVENT: &str = "recording_failed";

const TICK: Duration = Duration::from_secs(1);
/// Free space is checked every 10 ticks (it lists every volume).
const DISK_EVERY_TICKS: u64 = 10;

/// What to record in video mode (used from the Windows capture task on).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CaptureTarget {
    Monitor { id: String },
    Window { id: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    pub mode: Mode,
    pub target: Option<CaptureTarget>,
    pub devices: Vec<AudioDevice>,
    pub recordings_dir: String,
    pub quality: Quality,
    pub name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    User,
    LowDisk,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingFinished {
    pub path: String,
    pub name: String,
    pub duration_seconds: f64,
    pub has_video: bool,
    pub warning: Option<String>,
    pub stop_reason: StopReason,
    pub recovered: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailCode {
    TooShort,
    Capture,
    Encoder,
    Other,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RecordingFailed {
    pub code: FailCode,
    pub message: String,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn millis(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

struct Track {
    source: AudioSource,
    sink: Arc<Mutex<SegmentedWavSink>>,
}

struct OpenSegment {
    index: u32,
    started: Instant,
}

/// Segments and manifest of one session, without devices: the device callbacks
/// feed the sinks in the app, tests feed them by hand.
struct Segments {
    dir: PathBuf,
    manifest: Manifest,
    tracks: Vec<Track>,
    open: Option<OpenSegment>,
    next_index: u32,
}

impl Segments {
    fn new(dir: PathBuf, manifest: Manifest, tracks: Vec<Track>) -> Self {
        Self {
            dir,
            manifest,
            tracks,
            open: None,
            next_index: 1,
        }
    }

    /// Opens a sink for every source (a silent device is padded, so no source
    /// drops out of the mix) and records the segment in the manifest.
    fn open_segment(&mut self, now: Instant) -> Result<()> {
        if self.open.is_some() {
            bail!("a segment is already open");
        }
        let index = self.next_index;
        self.next_index += 1;
        // Set first: if one sink fails to open, `close_segment` still closes the others.
        self.open = Some(OpenSegment { index, started: now });
        self.manifest.segments.push(SegmentRecord {
            index,
            video_file: None,
            encoder: None,
            video_frames: 0,
            wall_ms: 0,
            audio: Vec::new(),
            closed: false,
        });
        for t in &self.tracks {
            let path = self.dir.join(segment_file(index, &format!("{}.wav", t.source.name())));
            lock(&t.sink).open(&path, now)?;
        }
        write_manifest_atomic(&self.dir, &self.manifest)
    }

    /// Closes the open segment at its active length (pause, rotation, stop).
    /// The records are kept in memory even if the manifest cannot be written.
    fn close_segment(&mut self, now: Instant) -> Result<()> {
        let Some(seg) = self.open.take() else {
            return Ok(());
        };
        let wall_ms = millis(now.saturating_duration_since(seg.started));
        let mut audio = Vec::new();
        for t in &self.tracks {
            match lock(&t.sink).close(wall_ms) {
                Ok(Some(rec)) => audio.push(rec),
                Ok(None) => {}
                Err(e) => tracing::error!("closing {} audio of segment {} failed: {e:#}", t.source.name(), seg.index),
            }
        }
        if let Some(rec) = self.manifest.segments.iter_mut().find(|s| s.index == seg.index) {
            rec.wall_ms = wall_ms;
            rec.audio = audio;
            rec.closed = true;
        }
        write_manifest_atomic(&self.dir, &self.manifest)
    }

    /// Why the open segment must be replaced now, if it must.
    fn rotation_reason(&self, now: Instant) -> Option<&'static str> {
        let seg = self.open.as_ref()?;
        if now.saturating_duration_since(seg.started) >= SEGMENT_MAX {
            return Some("segment reached its maximum length");
        }
        if self.tracks.iter().any(|t| lock(&t.sink).has_failed()) {
            return Some("an audio file stopped taking samples");
        }
        None
    }

    fn rotate(&mut self, now: Instant) -> Result<()> {
        self.close_segment(now)?;
        self.open_segment(now)
    }
}

struct StreamHandle(cpal::Stream);
// SAFETY: the stream is only paused and dropped, under the runtime mutex; the
// old `start_record` path moves streams between threads the same way.
unsafe impl Send for StreamHandle {}

struct ActiveRecording {
    status: Status,
    mode: Mode,
    recordings_dir: PathBuf,
    stem: String,
    clock: Instant,
    timeline: Timeline,
    segments: Segments,
    streams: Vec<StreamHandle>,
    lock: Option<SessionLock>,
    warnings: Vec<String>,
}

struct SaveJob {
    dir: PathBuf,
    recordings_dir: PathBuf,
    stem: String,
    manifest: Manifest,
    lock: Option<SessionLock>,
    stop_reason: StopReason,
    warnings: Vec<String>,
}

impl ActiveRecording {
    fn ms(&self, now: Instant) -> u64 {
        millis(now.saturating_duration_since(self.clock))
    }

    fn state(&self, now: Instant) -> RecordingStatePayload {
        RecordingStatePayload {
            status: self.status,
            mode: self.mode,
            active_ms: self.timeline.active_ms(self.ms(now)),
        }
    }

    fn pause(&mut self, now: Instant) -> Result<()> {
        transition(Some(self.status), Command::Pause)?;
        if let Err(e) = self.segments.close_segment(now) {
            tracing::error!("saving the manifest on pause failed: {e:#}");
        }
        let at = self.ms(now);
        self.timeline.pause(at);
        self.status = Status::Paused;
        Ok(())
    }

    /// Stops the devices, closes the open segment and hands the session to the saver.
    fn begin_stop(&mut self, reason: StopReason, now: Instant) -> SaveJob {
        self.status = Status::Finishing;
        for stream in self.streams.drain(..) {
            if let Err(e) = stream.0.pause() {
                tracing::warn!("pausing a capture stream failed: {e}");
            }
        }
        let at = self.ms(now);
        self.timeline.pause(at);
        if let Err(e) = self.segments.close_segment(now) {
            tracing::error!("saving the manifest on stop failed: {e:#}");
        }
        SaveJob {
            dir: self.segments.dir.clone(),
            recordings_dir: self.recordings_dir.clone(),
            stem: self.stem.clone(),
            manifest: self.segments.manifest.clone(),
            lock: self.lock.take(),
            stop_reason: reason,
            warnings: std::mem::take(&mut self.warnings),
        }
    }
}

/// Holds the session that is recording or saving now.
#[derive(Default)]
pub struct RecorderRuntime {
    inner: Mutex<Option<ActiveRecording>>,
}

impl RecorderRuntime {
    /// Working folder of the session recording or saving now: recovery must not touch it.
    pub fn active_dirs(&self) -> Vec<PathBuf> {
        lock(&self.inner).iter().map(|r| r.segments.dir.clone()).collect()
    }

    pub fn state(&self) -> Option<RecordingStatePayload> {
        lock(&self.inner).as_ref().map(|r| r.state(Instant::now()))
    }
}

fn emit_state(app: &AppHandle, state: RecordingStatePayload) {
    if let Err(e) = app.emit(STATE_EVENT, state) {
        tracing::warn!("emit {STATE_EVENT}: {e}");
    }
}

/// `.tyto-rec-<time>`; a second session within the same second gets a suffix.
fn create_session_dir(recordings_dir: &Path, started: &str) -> Result<PathBuf> {
    std::fs::create_dir_all(recordings_dir).with_context(|| format!("create {}", recordings_dir.display()))?;
    let mut dir = recordings_dir.join(format!("{SESSION_PREFIX}{started}"));
    let mut attempt = 0;
    loop {
        match std::fs::create_dir(&dir) {
            Ok(()) => return Ok(dir),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && attempt < 5 => {
                attempt += 1;
                dir = recordings_dir.join(format!("{SESSION_PREFIX}{started}-{}", crate::ffmpeg::random_string(4)));
            }
            Err(e) => return Err(e).with_context(|| format!("create {}", dir.display())),
        }
    }
}

fn open_device(host: &cpal::Host, d: &AudioDevice) -> Result<(cpal::Device, cpal::SupportedStreamConfig)> {
    if d.is_input {
        let id: usize = d.id.parse().context("Failed to parse device ID")?;
        let device = host.devices()?.nth(id).context("Failed to get device by ID")?;
        let config = device.default_input_config().context("Failed to get default input config")?;
        Ok((device, config))
    } else {
        get_output_device_and_config(host, d)
    }
}

fn start_session(
    app: &AppHandle,
    o: &StartOptions,
    recordings_dir: PathBuf,
    dir: PathBuf,
    started: String,
) -> Result<ActiveRecording> {
    let session_lock = SessionLock::acquire(&dir)?;
    let stem = o
        .name
        .as_deref()
        .map(crate::cmd::files::sanitize_filename_stem)
        .filter(|n| !n.is_empty())
        .unwrap_or(started);

    let host = cpal::default_host();
    let mut opened: Vec<(AudioSource, cpal::Device, cpal::SupportedStreamConfig)> = Vec::new();
    for d in &o.devices {
        let source = if d.is_input { AudioSource::Mic } else { AudioSource::System };
        if opened.iter().any(|(s, _, _)| *s == source) {
            bail!("two {} devices selected", source.name());
        }
        let (device, config) = open_device(&host, d)?;
        opened.push((source, device, config));
    }

    let meter = Arc::new(LevelMeter::new(app.clone()));
    let mut tracks = Vec::new();
    let mut streams = Vec::new();
    for (source, device, config) in opened {
        // Rate and channels stay fixed for the session: the concat lists cannot mix them.
        let rate: u32 = config.sample_rate();
        let channels: u16 = config.channels().max(1);
        tracing::debug!("recording {} at {rate} Hz, {channels} channels", source.name());
        let sink = Arc::new(Mutex::new(SegmentedWavSink::new(source, rate, channels)));
        let writer = sink.clone();
        let on_data = move |data: &[f32]| {
            // The sink places a block by its START time.
            let arrival = Instant::now();
            let frames = (data.len() / usize::from(channels)) as u64;
            let span = Duration::from_nanos(frames * 1_000_000_000 / u64::from(rate.max(1)));
            let start = arrival.checked_sub(span).unwrap_or(arrival);
            if let Ok(mut sink) = writer.try_lock() {
                sink.write(data, start);
            }
        };
        let stream = build_capture_stream(&device, config, on_data, meter.clone())?;
        tracks.push(Track { source, sink });
        streams.push(StreamHandle(stream));
    }

    let manifest = Manifest {
        version: MANIFEST_VERSION,
        mode: Mode::Audio,
        name: stem.clone(),
        started_at: chrono::Local::now().to_rfc3339(),
        quality: o.quality,
        size: None,
        fps: None,
        segments: Vec::new(),
        finalizing_to: None,
        final_bytes: None,
    };
    let mut segments = Segments::new(dir, manifest, tracks);
    let clock = Instant::now();
    segments.open_segment(clock)?;
    for stream in &streams {
        stream.0.play().context("start capture stream")?;
    }
    let mut timeline = Timeline::default();
    timeline.start(0);
    Ok(ActiveRecording {
        status: Status::Recording,
        mode: Mode::Audio,
        recordings_dir,
        stem,
        clock,
        timeline,
        segments,
        streams,
        lock: Some(session_lock),
        warnings: Vec::new(),
    })
}

pub fn start(app: &AppHandle, o: StartOptions) -> Result<()> {
    if o.mode == Mode::Video {
        bail!("video capture is not available");
    }
    if o.devices.is_empty() {
        bail!("At least one audio device is required");
    }
    let runtime = app.state::<RecorderRuntime>();
    let mut guard = lock(&runtime.inner);
    transition(guard.as_ref().map(|r| r.status), Command::Start)?;

    let recordings_dir = PathBuf::from(&o.recordings_dir);
    std::fs::create_dir_all(&recordings_dir).with_context(|| format!("create {}", recordings_dir.display()))?;
    if disk::free_space(&recordings_dir).is_some_and(|free| disk::should_stop(free, 0)) {
        bail!("not enough free disk space in {}", recordings_dir.display());
    }
    let started = crate::ffmpeg::get_local_time();
    let dir = create_session_dir(&recordings_dir, &started)?;
    let rec = match start_session(app, &o, recordings_dir, dir.clone(), started) {
        Ok(rec) => rec,
        Err(e) => {
            // Nothing was recorded; the lock and the streams are already dropped.
            if let Err(rm) = std::fs::remove_dir_all(&dir) {
                tracing::warn!("removing {} failed: {rm}", dir.display());
            }
            return Err(e);
        }
    };
    let state = rec.state(Instant::now());
    *guard = Some(rec);
    drop(guard);

    emit_state(app, state);
    crate::meeting_prompt::recording_started(app);
    spawn_watchdog(app.clone(), dir);
    Ok(())
}

pub fn pause(app: &AppHandle) -> Result<()> {
    let runtime = app.state::<RecorderRuntime>();
    let mut guard = lock(&runtime.inner);
    let rec = guard.as_mut().ok_or(SessionError::NotRecording)?;
    let now = Instant::now();
    rec.pause(now)?;
    emit_state(app, rec.state(now));
    Ok(())
}

/// A segment that cannot be opened (disk full, device gone) stops the session
/// and saves what was recorded, with the reason as a warning.
pub fn resume(app: &AppHandle) -> Result<()> {
    let runtime = app.state::<RecorderRuntime>();
    let mut guard = lock(&runtime.inner);
    let rec = guard.as_mut().ok_or(SessionError::NotRecording)?;
    transition(Some(rec.status), Command::Resume)?;
    let now = Instant::now();
    match rec.segments.open_segment(now) {
        Ok(()) => {
            let at = rec.ms(now);
            rec.timeline.resume(at);
            rec.status = Status::Recording;
            emit_state(app, rec.state(now));
        }
        Err(e) => {
            tracing::error!("resuming failed, stopping: {e:#}");
            rec.warnings.push(format!("Recording stopped: {e:#}"));
            let job = rec.begin_stop(StopReason::User, now);
            emit_state(app, rec.state(now));
            drop(guard);
            spawn_save(app.clone(), job);
        }
    }
    Ok(())
}

/// `only`: stop only if this is still the running session (the watchdog's own stop).
pub fn stop(app: &AppHandle, only: Option<&Path>, reason: StopReason) -> Result<()> {
    let runtime = app.state::<RecorderRuntime>();
    let job = {
        let mut guard = lock(&runtime.inner);
        let rec = guard.as_mut().ok_or(SessionError::NotRecording)?;
        if only.is_some_and(|d| d != rec.segments.dir.as_path()) {
            return Ok(());
        }
        transition(Some(rec.status), Command::Stop)?;
        let now = Instant::now();
        let job = rec.begin_stop(reason, now);
        emit_state(app, rec.state(now));
        job
    };
    spawn_save(app.clone(), job);
    Ok(())
}

pub fn state(app: &AppHandle) -> Option<RecordingStatePayload> {
    app.state::<RecorderRuntime>().state()
}

/// Once a second: `recording_state`, segment rotation, and every 10 s the free
/// space (stop and save with `low_disk` below the reserve).
fn spawn_watchdog(app: AppHandle, dir: PathBuf) {
    std::thread::spawn(move || {
        let mut tick: u64 = 0;
        loop {
            std::thread::sleep(TICK);
            tick += 1;
            let runtime = app.state::<RecorderRuntime>();
            let mut job = None;
            let active_ms = {
                let mut guard = lock(&runtime.inner);
                let Some(rec) = guard.as_mut().filter(|r| r.segments.dir == dir) else {
                    return;
                };
                if rec.status == Status::Finishing {
                    return;
                }
                let now = Instant::now();
                if rec.status == Status::Recording {
                    if let Some(why) = rec.segments.rotation_reason(now) {
                        tracing::info!("new segment: {why}");
                        if let Err(e) = rec.segments.rotate(now) {
                            tracing::error!("rotating the segment failed, stopping: {e:#}");
                            rec.warnings.push(format!("Recording stopped: {e:#}"));
                            job = Some(rec.begin_stop(StopReason::User, now));
                        }
                    }
                }
                let state = rec.state(now);
                emit_state(&app, state);
                state.active_ms
            };
            if let Some(job) = job {
                spawn_save(app.clone(), job);
                return;
            }
            if tick.is_multiple_of(DISK_EVERY_TICKS) {
                let Some(free) = disk::free_space(&dir) else {
                    continue;
                };
                if disk::should_stop(free, disk::mux_reserve(&dir, active_ms)) {
                    tracing::warn!("{free} bytes free, stopping the recording");
                    if let Err(e) = stop(&app, Some(dir.as_path()), StopReason::LowDisk) {
                        tracing::error!("low-disk stop failed: {e:#}");
                    }
                    return;
                }
            }
        }
    });
}

fn spawn_save(app: AppHandle, job: SaveJob) {
    std::thread::spawn(move || {
        let dir = job.dir.clone();
        let outcome = save(job, crate::ffmpeg::find_ffmpeg_path());
        {
            let runtime = app.state::<RecorderRuntime>();
            let mut guard = lock(&runtime.inner);
            if guard.as_ref().is_some_and(|r| r.segments.dir == dir) {
                *guard = None;
            }
        }
        let emitted = match &outcome {
            Ok(finished) => app.emit(FINISHED_EVENT, finished),
            Err(failed) => app.emit(FAILED_EVENT, failed),
        };
        if let Err(e) = emitted {
            tracing::error!("emit recording result: {e}");
        }
        crate::meeting_prompt::recording_stopped(&app);
    });
}

/// `finalizing_to` names of other sessions' manifests (lowercase): a session
/// being saved or waiting for recovery has reserved them.
fn reserved_names(recordings_dir: &Path, own_dir: &Path) -> HashSet<String> {
    let Ok(entries) = std::fs::read_dir(recordings_dir) else {
        return HashSet::new();
    };
    entries
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(SESSION_PREFIX))
        .map(|e| e.path())
        .filter(|p| p.as_path() != own_dir)
        .filter_map(|p| read_manifest(&p).ok()?.finalizing_to)
        .filter_map(|to| Path::new(&to).file_name().map(|n| n.to_string_lossy().to_lowercase()))
        .collect()
}

/// Free name for the final file: `stem.ext`, `stem (1).ext`, ... skipping files
/// on disk and names in `taken` (compared lowercase).
fn pick_output_path(recordings_dir: &Path, stem: &str, ext: &str, taken: &HashSet<String>) -> PathBuf {
    let ext = ext.trim_start_matches('.');
    let mut n = 0u32;
    loop {
        let name = if n == 0 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem} ({n}).{ext}")
        };
        let path = recordings_dir.join(&name);
        if !path.exists() && !taken.contains(&name.to_lowercase()) {
            return path;
        }
        n += 1;
    }
}

fn plan_seconds(plan: &FinalizePlan) -> f64 {
    let secs: f64 = plan
        .audio
        .first()
        .map(|(_, entries)| entries.iter().map(|(_, s)| s.unwrap_or(0.0)).sum::<f64>())
        .unwrap_or(0.0);
    (secs * 1000.0).round() / 1000.0
}

fn run_ffmpeg(ffmpeg: &Path, args: &[String]) -> Result<()> {
    let mut cmd = Process::new(ffmpeg);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().with_context(|| format!("run {}", ffmpeg.display()))?;
    if !out.status.success() {
        let stderr: String = String::from_utf8_lossy(&out.stderr).chars().take(2000).collect();
        bail!("ffmpeg failed ({}): {}", out.status, stderr.trim());
    }
    Ok(())
}

fn rename_with_retry(from: &Path, to: &Path) -> Result<()> {
    let mut attempt = 0;
    loop {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            // An antivirus or the indexer may hold the fresh file for a moment.
            Err(_) if attempt < 5 => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e).with_context(|| format!("rename to {}", to.display())),
        }
    }
}

fn mux(job: &mut SaveJob, plan: &FinalizePlan, ffmpeg: Option<PathBuf>) -> Result<PathBuf> {
    let ffmpeg = ffmpeg.context("ffmpeg not found")?;
    let taken = reserved_names(&job.recordings_dir, &job.dir);
    let final_path = pick_output_path(&job.recordings_dir, &job.stem, plan.ext, &taken);
    let name = final_path
        .file_name()
        .context("final file name")?
        .to_string_lossy()
        .into_owned();
    job.manifest.finalizing_to = Some(name);
    job.manifest.final_bytes = None;
    write_manifest_atomic(&job.dir, &job.manifest)?;
    write_concat_lists(plan, &job.dir)?;
    let partial = job.dir.join(format!("final.partial.{}", plan.ext));
    let args = finalize_args(plan, &job.dir, &partial, VideoEncoder::X264, &preset(job.manifest.quality));
    run_ffmpeg(&ffmpeg, &args)?;
    if !partial.is_file() {
        bail!("ffmpeg wrote no {}", partial.display());
    }
    record_final_bytes(&job.dir, &mut job.manifest, &partial)?;
    rename_with_retry(&partial, &final_path)?;
    Ok(final_path)
}

/// Finalizes a stopped session. Nothing recorded: the working folder is removed
/// and the result is `too_short`. A failed mux keeps the folder for recovery.
fn save(mut job: SaveJob, ffmpeg: Option<PathBuf>) -> Result<RecordingFinished, RecordingFailed> {
    let plan = match finalize_plan(&job.manifest) {
        Ok(plan) => plan,
        Err(FinalizeError::Empty) => {
            drop(job.lock.take());
            if let Err(e) = discard_unfinished(&job.dir, &[]) {
                tracing::warn!("removing an empty recording failed: {e:#}");
            }
            return Err(RecordingFailed {
                code: FailCode::TooShort,
                message: FinalizeError::Empty.to_string(),
            });
        }
    };
    match mux(&mut job, &plan, ffmpeg) {
        Ok(final_path) => {
            drop(job.lock.take());
            if let Err(e) = remove_working_dir(&job.dir, &final_path, &[]) {
                tracing::warn!("{e:#}");
            }
            Ok(RecordingFinished {
                path: final_path.to_string_lossy().into_owned(),
                name: final_path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                duration_seconds: plan_seconds(&plan),
                has_video: !plan.video.is_empty(),
                warning: (!job.warnings.is_empty()).then(|| job.warnings.join("; ")),
                stop_reason: job.stop_reason,
                recovered: false,
            })
        }
        Err(e) => {
            tracing::error!("saving the recording failed, keeping {}: {e:#}", job.dir.display());
            Err(RecordingFailed {
                code: FailCode::Encoder,
                message: format!("{e:#}. The recording is kept in {}", job.dir.display()),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> Manifest {
        Manifest {
            version: MANIFEST_VERSION,
            mode: Mode::Audio,
            name: "2026-10-31 14-05-33".into(),
            started_at: "2026-10-31T14:05:33+03:00".into(),
            quality: Quality::Good,
            size: None,
            fps: None,
            segments: Vec::new(),
            finalizing_to: None,
            final_bytes: None,
        }
    }

    fn mic_session(dir: &Path) -> Segments {
        let sink = Arc::new(Mutex::new(SegmentedWavSink::new(AudioSource::Mic, 1_000, 1)));
        Segments::new(
            dir.to_path_buf(),
            manifest(),
            vec![Track {
                source: AudioSource::Mic,
                sink,
            }],
        )
    }

    fn feed(s: &Segments, frames: usize, at: Instant) {
        lock(&s.tracks[0].sink).write(&vec![0.25; frames], at);
    }

    fn job(recordings: &Path, s: &Segments, session_lock: Option<SessionLock>) -> SaveJob {
        SaveJob {
            dir: s.dir.clone(),
            recordings_dir: recordings.to_path_buf(),
            stem: "2026-10-31 14-05-33".into(),
            manifest: s.manifest.clone(),
            lock: session_lock,
            stop_reason: StopReason::User,
            warnings: Vec::new(),
        }
    }

    #[test]
    fn pause_closes_the_segment_at_its_active_length() {
        let root = tempfile::tempdir().unwrap();
        let dir = create_session_dir(root.path(), "2026-10-31 14-05-33").unwrap();
        let mut s = mic_session(&dir);
        let t0 = Instant::now();
        s.open_segment(t0).unwrap();
        assert!(!read_manifest(&dir).unwrap().segments[0].closed);
        feed(&s, 500, t0);
        s.close_segment(t0 + Duration::from_millis(500)).unwrap();
        // paused for 30 s: nothing is written, the next segment starts on resume
        feed(&s, 100, t0 + Duration::from_secs(10));
        let t1 = t0 + Duration::from_secs(30);
        s.open_segment(t1).unwrap();
        feed(&s, 300, t1);
        s.close_segment(t1 + Duration::from_millis(300)).unwrap();

        let m = read_manifest(&dir).unwrap();
        assert_eq!(m, s.manifest);
        let lengths: Vec<(u32, u64, bool)> = m.segments.iter().map(|g| (g.index, g.wall_ms, g.closed)).collect();
        assert_eq!(lengths, vec![(1, 500, true), (2, 300, true)]);
        assert_eq!(m.segments[0].audio[0].captured_frames, 500);
        let plan = finalize_plan(&m).unwrap();
        assert_eq!(
            plan.audio[0].1,
            vec![
                ("seg-0001.mic.wav".to_string(), Some(0.5)),
                ("seg-0002.mic.wav".to_string(), Some(0.3))
            ]
        );
        assert_eq!(plan_seconds(&plan), 0.8);
        assert_eq!(plan.ext, "m4a");
    }

    #[test]
    fn a_long_or_failed_segment_asks_for_rotation() {
        let root = tempfile::tempdir().unwrap();
        let mut s = mic_session(root.path());
        let t0 = Instant::now();
        assert_eq!(s.rotation_reason(t0), None);
        s.open_segment(t0).unwrap();
        assert_eq!(s.rotation_reason(t0 + Duration::from_secs(60)), None);
        assert!(s.rotation_reason(t0 + SEGMENT_MAX).is_some());
        s.rotate(t0 + SEGMENT_MAX).unwrap();
        assert_eq!(s.manifest.segments.len(), 2);
        assert!(s.manifest.segments[0].closed && !s.manifest.segments[1].closed);
        assert_eq!(s.rotation_reason(t0 + SEGMENT_MAX), None);
    }

    #[test]
    fn stop_right_after_start_is_too_short_and_leaves_nothing() {
        let root = tempfile::tempdir().unwrap();
        let dir = create_session_dir(root.path(), "2026-10-31 14-05-33").unwrap();
        let session_lock = SessionLock::acquire(&dir).unwrap();
        let mut s = mic_session(&dir);
        let t0 = Instant::now();
        s.open_segment(t0).unwrap();
        s.close_segment(t0 + Duration::from_millis(300)).unwrap();
        let failed = save(job(root.path(), &s, Some(session_lock)), None).unwrap_err();
        assert_eq!(failed.code, FailCode::TooShort);
        assert!(!dir.exists());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_failed_mux_keeps_the_working_folder() {
        let root = tempfile::tempdir().unwrap();
        let dir = create_session_dir(root.path(), "2026-10-31 14-05-33").unwrap();
        let mut s = mic_session(&dir);
        let t0 = Instant::now();
        s.open_segment(t0).unwrap();
        feed(&s, 1_000, t0);
        s.close_segment(t0 + Duration::from_secs(1)).unwrap();
        let missing = root.path().join("no-ffmpeg-here");
        let failed = save(job(root.path(), &s, None), Some(missing)).unwrap_err();
        assert_eq!(failed.code, FailCode::Encoder);
        assert!(dir.join("seg-0001.mic.wav").is_file());
        let m = read_manifest(&dir).unwrap();
        assert_eq!(m.finalizing_to.as_deref(), Some("2026-10-31 14-05-33.m4a"));
        assert_eq!(m.final_bytes, None);
        assert!(!root.path().join("2026-10-31 14-05-33.m4a").exists());
    }

    #[test]
    fn the_final_name_skips_files_and_names_reserved_by_other_sessions() {
        let root = tempfile::tempdir().unwrap();
        let own = create_session_dir(root.path(), "2026-10-31 14-05-33").unwrap();
        let other = create_session_dir(root.path(), "2026-10-31 14-05-33").unwrap();
        assert_ne!(own, other);
        let mut theirs = manifest();
        theirs.finalizing_to = Some("Встреча.m4a".into());
        write_manifest_atomic(&other, &theirs).unwrap();
        // our own reservation does not block us
        let mut ours = manifest();
        ours.finalizing_to = Some("Планерка.m4a".into());
        write_manifest_atomic(&own, &ours).unwrap();

        let taken = reserved_names(root.path(), &own);
        assert_eq!(taken, HashSet::from(["встреча.m4a".to_string()]));
        assert_eq!(
            pick_output_path(root.path(), "Встреча", "m4a", &taken),
            root.path().join("Встреча (1).m4a")
        );
        assert_eq!(
            pick_output_path(root.path(), "Планерка", "m4a", &taken),
            root.path().join("Планерка.m4a")
        );
        std::fs::write(root.path().join("Планерка.m4a"), b"x").unwrap();
        assert_eq!(
            pick_output_path(root.path(), "Планерка", ".m4a", &taken),
            root.path().join("Планерка (1).m4a")
        );
    }

    #[test]
    fn start_options_and_events_use_the_frontend_shape() {
        let o: StartOptions = serde_json::from_value(serde_json::json!({
            "mode": "audio",
            "target": { "kind": "window", "id": "42" },
            "devices": [{ "isDefault": true, "isInput": true, "id": "0", "name": "Mic" }],
            "recordingsDir": "C:/Users/d/Documents/Tyto/Записи",
            "quality": "good",
            "name": null
        }))
        .unwrap();
        assert_eq!(o.mode, Mode::Audio);
        assert_eq!(o.target, Some(CaptureTarget::Window { id: "42".into() }));
        assert_eq!(o.recordings_dir, "C:/Users/d/Documents/Tyto/Записи");

        let finished = serde_json::to_value(RecordingFinished {
            path: "p".into(),
            name: "n".into(),
            duration_seconds: 65.0,
            has_video: false,
            warning: None,
            stop_reason: StopReason::LowDisk,
            recovered: false,
        })
        .unwrap();
        assert_eq!(finished["stopReason"], "low_disk");
        assert_eq!(finished["durationSeconds"], 65.0);
        assert!(finished["warning"].is_null());
        assert_eq!(finished["hasVideo"], serde_json::json!(false));
        let failed = serde_json::to_value(RecordingFailed {
            code: FailCode::TooShort,
            message: "m".into(),
        })
        .unwrap();
        assert_eq!(failed["code"], "too_short");
    }
}
