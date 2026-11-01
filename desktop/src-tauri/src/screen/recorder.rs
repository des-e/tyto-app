//! Recording runtime: devices, segments, rotation, the disk watch and saving.
//!
//! Every file goes straight into `<Записи>/.tyto-rec-<time>/` (never the temp
//! folder that `cleaner.rs` empties).
//!
//! Threads of a session:
//! - the device callbacks only copy a block into a bounded queue (`BlockSender`):
//!   no lock, no file I/O; a full queue drops the block and counts it;
//! - one writer thread owns the sinks and the manifest: it drains the queues,
//!   fills silence step by step while a source sends nothing, rotates segments
//!   (`SEGMENT_MAX`, a failed sink) and closes them on pause and stop;
//! - a watchdog emits `recording_state` once a second, stops on low disk and
//!   on a lost device or a failed write;
//! - the saver muxes after stop.
//!
//! Save order (see `recovery`): `SessionLock` from the start → `finalizing_to`
//! → mux into `final.partial.<ext>` → `record_final_bytes` → rename (never over
//! an existing file) → drop the lock → `remove_working_dir`. A failed mux keeps
//! the working folder.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command as Process, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use eyre::{bail, Context, ContextCompat, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::audio_sink::SegmentedWavSink;
use super::disk;
use super::encoder::VideoEncoder;
use super::quality::{preset, Quality};
use super::recovery::{
    discard_unfinished, ensure_session_dir, prepare_recovery, probe_video_seconds, record_final_bytes, remove_working_dir,
    RecoveryAction, SessionLock,
};
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

/// `RecordingFinished.warning` codes; the frontend shows its own text for them.
pub const WARN_DEVICE_LOST: &str = "device_lost";
pub const WARN_WRITE_FAILED: &str = "write_failed";

const TICK: Duration = Duration::from_secs(1);
/// Free space is checked every 10 ticks (it lists every volume).
const DISK_EVERY_TICKS: u64 = 10;
const WRITER_TICK: Duration = Duration::from_millis(15);
/// Blocks queued per source (a few seconds of audio): the writer may be busy for a moment.
const BLOCK_QUEUE: usize = 1024;
const SPARE_BUFFERS: usize = 64;
/// A source that sent nothing for this long is filled with silence as time goes,
/// up to `FILL_MARGIN` behind the clock (blocks still on their way fit after it).
const IDLE_BEFORE_FILL: Duration = Duration::from_millis(500);
const FILL_MARGIN: Duration = Duration::from_millis(300);
/// A microphone delivers blocks even in silence: none for this long means it is gone.
/// (Loopback legitimately sends nothing while nothing plays, so it is not checked.)
const STALL_AFTER: Duration = Duration::from_secs(3);
/// Until its first block (at start and again after a resume) a microphone gets
/// longer: a Bluetooth headset switching to hands-free or a USB camera mic can
/// take seconds to deliver.
const FIRST_BLOCK_GRACE: Duration = Duration::from_secs(10);
/// A sink that fails again this soon after a rotation is not retried: the
/// session stops and saves instead of making a new segment every tick.
const FAILURE_RETRY: Duration = Duration::from_secs(5);
const MANIFEST_WAIT: Duration = Duration::from_secs(120);

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

/// Problems found by the callbacks and the writer; the watchdog acts on them.
#[derive(Default)]
struct Health {
    /// A device went away (stream error) or the microphone stalled.
    device_lost: AtomicBool,
    /// The writer could not open a segment or save the manifest.
    write_failed: AtomicBool,
    /// Frames dropped because a queue was full.
    dropped_frames: AtomicU64,
}

struct Block {
    /// Time of the block's first frame.
    start: Instant,
    samples: Vec<f32>,
}

/// The device-callback side of a source: copies the block into the queue and
/// returns. Never blocks and never touches a file.
struct BlockSender {
    blocks: SyncSender<Block>,
    spares: Receiver<Vec<f32>>,
    rate: u32,
    channels: u16,
    health: Arc<Health>,
}

impl BlockSender {
    fn push(&mut self, data: &[f32], arrival: Instant) {
        let frames = (data.len() / usize::from(self.channels.max(1))) as u64;
        let span = Duration::from_nanos(frames * 1_000_000_000 / u64::from(self.rate.max(1)));
        // The sink places a block by its START time.
        let start = arrival.checked_sub(span).unwrap_or(arrival);
        let mut samples = self.spares.try_recv().unwrap_or_default();
        samples.clear();
        samples.extend_from_slice(data);
        if self.blocks.try_send(Block { start, samples }).is_err() {
            self.health.dropped_frames.fetch_add(frames, Ordering::Relaxed);
        }
    }
}

/// The writer side of a source.
struct Input {
    blocks: Receiver<Block>,
    spares: SyncSender<Vec<f32>>,
    last_data: Option<Instant>,
    /// A block arrived since the stall window was armed (start, resume).
    flowing: bool,
}

fn source_queue(rate: u32, channels: u16, health: Arc<Health>) -> (BlockSender, Input) {
    let (block_tx, block_rx) = mpsc::sync_channel(BLOCK_QUEUE);
    let (spare_tx, spare_rx) = mpsc::sync_channel(SPARE_BUFFERS);
    // Buffers of 100 ms ready before the first callback: it does not allocate.
    let capacity = (rate as usize / 10).max(1) * usize::from(channels.max(1));
    for _ in 0..SPARE_BUFFERS {
        let _ = spare_tx.try_send(Vec::with_capacity(capacity));
    }
    (
        BlockSender {
            blocks: block_tx,
            spares: spare_rx,
            rate,
            channels,
            health,
        },
        Input {
            blocks: block_rx,
            spares: spare_tx,
            last_data: None,
            flowing: false,
        },
    )
}

struct Track {
    source: AudioSource,
    sink: SegmentedWavSink,
}

struct OpenSegment {
    index: u32,
    started: Instant,
}

/// Segments and manifest of one session. Owned by the writer thread (the only
/// one that writes the manifest while recording).
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
        for t in &mut self.tracks {
            let path = self.dir.join(segment_file(index, &format!("{}.wav", t.source.name())));
            t.sink.open(&path, now)?;
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
        for t in &mut self.tracks {
            match t.sink.close(wall_ms) {
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
        if self.tracks.iter().any(|t| t.sink.has_failed()) {
            return Some("an audio file stopped taking samples");
        }
        None
    }

    /// The new segment starts at the same instant the old one ends.
    fn rotate(&mut self, now: Instant) -> Result<()> {
        self.close_segment(now)?;
        self.open_segment(now)
    }
}

enum Ctl {
    Pause(Instant),
    Resume(Instant),
    /// Close the open segment and hand the manifest back.
    Finish(Instant, Sender<Manifest>),
}

struct Writer {
    segments: Segments,
    inputs: Vec<Input>,
    health: Arc<Health>,
    ctl: Receiver<Ctl>,
    stall_reported: bool,
    /// Start of the stall window: the session start, then every resume.
    armed_at: Option<Instant>,
    /// Last rotation caused by a failed sink.
    failure_rotation: Option<Instant>,
}

impl Writer {
    fn new(segments: Segments, inputs: Vec<Input>, health: Arc<Health>, ctl: Receiver<Ctl>, armed_at: Instant) -> Self {
        Self {
            segments,
            inputs,
            health,
            ctl,
            stall_reported: false,
            armed_at: Some(armed_at),
            failure_rotation: None,
        }
    }

    /// Writes the queued blocks; with `skip_before`, blocks that start earlier are dropped.
    fn drain(&mut self, skip_before: Option<Instant>) {
        for (input, track) in self.inputs.iter_mut().zip(self.segments.tracks.iter_mut()) {
            while let Ok(block) = input.blocks.try_recv() {
                input.last_data = Some(block.start);
                input.flowing = true;
                if skip_before.is_none_or(|at| block.start >= at) {
                    track.sink.write(&block.samples, block.start);
                }
                // A full spare queue just lets the buffer go.
                let _ = input.spares.try_send(block.samples);
            }
        }
    }

    fn arm(&mut self, at: Instant) {
        self.armed_at = Some(at);
        for input in &mut self.inputs {
            input.flowing = false;
        }
    }

    fn fail(&self, what: &str, e: &eyre::Report) {
        tracing::error!("{what}: {e:#}");
        self.health.write_failed.store(true, Ordering::SeqCst);
    }

    fn tick(&mut self, now: Instant) {
        self.drain(None);
        let Some(seg_start) = self.segments.open.as_ref().map(|s| s.started) else {
            return;
        };
        if let Some(until) = now.checked_sub(FILL_MARGIN) {
            for (input, track) in self.inputs.iter().zip(self.segments.tracks.iter_mut()) {
                let idle = input
                    .last_data
                    .is_none_or(|t| now.saturating_duration_since(t) >= IDLE_BEFORE_FILL);
                if idle {
                    track.sink.catch_up(until);
                }
            }
        }
        if !self.stall_reported {
            let armed = self.armed_at.unwrap_or(seg_start);
            for (input, track) in self.inputs.iter().zip(self.segments.tracks.iter()) {
                if track.source != AudioSource::Mic {
                    continue;
                }
                let stalled = match (input.flowing, input.last_data) {
                    (true, Some(t)) => now.saturating_duration_since(t.max(armed)) > STALL_AFTER,
                    _ => now.saturating_duration_since(armed) > FIRST_BLOCK_GRACE,
                };
                if stalled {
                    tracing::error!("the microphone stopped sending audio");
                    self.stall_reported = true;
                    self.health.device_lost.store(true, Ordering::SeqCst);
                }
            }
        }
        if self.health.write_failed.load(Ordering::SeqCst) {
            return;
        }
        if let Some(why) = self.segments.rotation_reason(now) {
            if self.segments.tracks.iter().any(|t| t.sink.has_failed()) {
                if self
                    .failure_rotation
                    .is_some_and(|t| now.saturating_duration_since(t) < FAILURE_RETRY)
                {
                    tracing::error!("an audio file failed again right after a new segment, stopping");
                    self.health.write_failed.store(true, Ordering::SeqCst);
                    return;
                }
                self.failure_rotation = Some(now);
            }
            tracing::info!("new segment: {why}");
            if let Err(e) = self.segments.rotate(now) {
                self.fail("rotating the segment failed", &e);
            }
        }
    }

    fn run(mut self) {
        loop {
            match self.ctl.recv_timeout(WRITER_TICK) {
                Ok(Ctl::Pause(at)) => {
                    self.drain(None);
                    if let Err(e) = self.segments.close_segment(at) {
                        tracing::error!("saving the manifest on pause failed: {e:#}");
                    }
                }
                Ok(Ctl::Resume(at)) => {
                    // Open first, then keep the queued blocks from `at` on; the pause's blocks go.
                    if let Err(e) = self.segments.open_segment(at) {
                        self.fail("opening a segment on resume failed", &e);
                    }
                    self.arm(at);
                    self.drain(Some(at));
                }
                Ok(Ctl::Finish(at, reply)) => {
                    self.drain(None);
                    if let Err(e) = self.segments.close_segment(at) {
                        tracing::error!("saving the manifest on stop failed: {e:#}");
                    }
                    let _ = reply.send(self.segments.manifest.clone());
                    return;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    self.drain(None);
                    let _ = self.segments.close_segment(Instant::now());
                    return;
                }
            }
            self.tick(Instant::now());
        }
    }
}

struct StreamHandle(cpal::Stream);
// SAFETY: the stream is only paused and dropped, under the runtime mutex; the
// old `start_record` path moves streams between threads the same way.
unsafe impl Send for StreamHandle {}

struct ActiveRecording {
    status: Status,
    mode: Mode,
    dir: PathBuf,
    recordings_dir: PathBuf,
    stem: String,
    clock: Instant,
    timeline: Timeline,
    ctl: Sender<Ctl>,
    writer: Option<JoinHandle<()>>,
    streams: Vec<StreamHandle>,
    lock: Option<SessionLock>,
    health: Arc<Health>,
    warnings: Vec<&'static str>,
}

/// A stopped session whose writer is closing the last segment.
struct PendingSave {
    manifest: Receiver<Manifest>,
    writer: Option<JoinHandle<()>>,
    dir: PathBuf,
    recordings_dir: PathBuf,
    stem: String,
    lock: Option<SessionLock>,
    stop_reason: StopReason,
    warnings: Vec<&'static str>,
}

struct SaveJob {
    dir: PathBuf,
    recordings_dir: PathBuf,
    stem: String,
    manifest: Manifest,
    lock: Option<SessionLock>,
    stop_reason: StopReason,
    warnings: Vec<&'static str>,
}

impl PendingSave {
    fn into_job(self) -> Result<SaveJob, RecordingFailed> {
        let manifest = match self.manifest.recv_timeout(MANIFEST_WAIT) {
            Ok(m) => {
                if let Some(writer) = self.writer {
                    let _ = writer.join();
                }
                m
            }
            Err(e) => {
                tracing::error!("the writer did not hand the manifest back ({e}), reading it from disk");
                read_manifest(&self.dir).map_err(|e| RecordingFailed {
                    code: FailCode::Other,
                    message: format!("{e:#}. The recording is kept in {}", self.dir.display()),
                })?
            }
        };
        Ok(SaveJob {
            dir: self.dir,
            recordings_dir: self.recordings_dir,
            stem: self.stem,
            manifest,
            lock: self.lock,
            stop_reason: self.stop_reason,
            warnings: self.warnings,
        })
    }
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

    fn send(&self, ctl: Ctl) {
        if self.ctl.send(ctl).is_err() {
            tracing::error!("the recording writer is gone");
            self.health.write_failed.store(true, Ordering::SeqCst);
        }
    }

    fn pause(&mut self, now: Instant) -> Result<()> {
        transition(Some(self.status), Command::Pause)?;
        self.send(Ctl::Pause(now));
        let at = self.ms(now);
        self.timeline.pause(at);
        self.status = Status::Paused;
        Ok(())
    }

    fn resume(&mut self, now: Instant) -> Result<()> {
        transition(Some(self.status), Command::Resume)?;
        self.send(Ctl::Resume(now));
        let at = self.ms(now);
        self.timeline.resume(at);
        self.status = Status::Recording;
        Ok(())
    }

    /// Stops the devices and asks the writer to close the open segment; the
    /// saver waits for the manifest outside the runtime lock.
    fn begin_stop(&mut self, reason: StopReason, now: Instant) -> PendingSave {
        self.status = Status::Finishing;
        for stream in self.streams.drain(..) {
            if let Err(e) = stream.0.pause() {
                tracing::warn!("pausing a capture stream failed: {e}");
            }
        }
        let at = self.ms(now);
        self.timeline.pause(at);
        let (tx, rx) = mpsc::channel();
        self.send(Ctl::Finish(now, tx));
        let dropped = self.health.dropped_frames.load(Ordering::Relaxed);
        if dropped > 0 {
            tracing::warn!("{dropped} audio frames were dropped (writer queue full)");
        }
        PendingSave {
            manifest: rx,
            writer: self.writer.take(),
            dir: self.dir.clone(),
            recordings_dir: self.recordings_dir.clone(),
            stem: self.stem.clone(),
            lock: self.lock.take(),
            stop_reason: reason,
            warnings: std::mem::take(&mut self.warnings),
        }
    }
}

/// Holds the session that is recording or saving now, and the running mux.
#[derive(Default)]
pub struct RecorderRuntime {
    inner: Mutex<Option<ActiveRecording>>,
    ffmpeg: Mutex<Option<Child>>,
    /// Folders being recovered right now (a second request for one is refused).
    recovering: Mutex<Vec<PathBuf>>,
    /// The mux of a recovery; its own slot, so it never meets the live session's ffmpeg.
    recovery_ffmpeg: Mutex<Option<Child>>,
}

/// Marks a folder as being recovered until dropped.
struct RecoveryGuard<'a> {
    runtime: &'a RecorderRuntime,
    dir: PathBuf,
}

impl Drop for RecoveryGuard<'_> {
    fn drop(&mut self) {
        lock(&self.runtime.recovering).retain(|d| d != &self.dir);
    }
}

impl RecorderRuntime {
    /// Working folder of the session recording or saving now.
    fn session_dirs(&self) -> Vec<PathBuf> {
        lock(&self.inner).iter().map(|r| r.dir.clone()).collect()
    }

    /// Folders recovery must not offer or touch: the session recording or saving
    /// now, and the ones being recovered.
    pub fn active_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = self.session_dirs();
        dirs.extend(lock(&self.recovering).iter().cloned());
        dirs
    }

    fn begin_recovery(&self, dir: &Path) -> Result<RecoveryGuard<'_>> {
        let mut busy = lock(&self.recovering);
        if busy.iter().any(|d| d == dir) {
            bail!("{} is already being recovered", dir.display());
        }
        busy.push(dir.to_path_buf());
        Ok(RecoveryGuard {
            runtime: self,
            dir: dir.to_path_buf(),
        })
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

fn is_device_lost(kind: cpal::ErrorKind) -> bool {
    matches!(
        kind,
        cpal::ErrorKind::DeviceNotAvailable | cpal::ErrorKind::StreamInvalidated | cpal::ErrorKind::HostUnavailable
    )
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

    let health = Arc::new(Health::default());
    let meter = Arc::new(LevelMeter::new(app.clone()));
    let mut tracks = Vec::new();
    let mut inputs = Vec::new();
    let mut streams = Vec::new();
    for (source, device, config) in opened {
        // Rate and channels stay fixed for the session: the concat lists cannot mix them.
        let rate: u32 = config.sample_rate();
        let channels: u16 = config.channels().max(1);
        tracing::debug!("recording {} at {rate} Hz, {channels} channels", source.name());
        let (mut sender, input) = source_queue(rate, channels, health.clone());
        let lost = health.clone();
        let stream = build_capture_stream(
            &device,
            config,
            move |data: &[f32]| sender.push(data, Instant::now()),
            move |err: cpal::Error| {
                if is_device_lost(err.kind()) {
                    lost.device_lost.store(true, Ordering::SeqCst);
                }
            },
            meter.clone(),
        )?;
        tracks.push(Track {
            source,
            sink: SegmentedWavSink::new(source, rate, channels),
        });
        inputs.push(input);
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
    let mut segments = Segments::new(dir.clone(), manifest, tracks);
    let clock = Instant::now();
    // Opened before the devices play: their latency is padded by the sinks.
    segments.open_segment(clock)?;
    // The writer starts only after the devices play: if one fails, the files are
    // closed when `segments` drops here, and the folder can be removed at once.
    // Blocks queue up meanwhile.
    for stream in &streams {
        stream.0.play().context("start capture stream")?;
    }
    let (ctl_tx, ctl_rx) = mpsc::channel();
    let writer = Writer::new(segments, inputs, health.clone(), ctl_rx, clock);
    let writer = std::thread::Builder::new()
        .name("tyto-rec-writer".into())
        .spawn(move || writer.run())
        .context("start the recording writer")?;
    let mut timeline = Timeline::default();
    timeline.start(0);
    Ok(ActiveRecording {
        status: Status::Recording,
        mode: Mode::Audio,
        dir,
        recordings_dir,
        stem,
        clock,
        timeline,
        ctl: ctl_tx,
        writer: Some(writer),
        streams,
        lock: Some(session_lock),
        health,
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
            // Nothing was recorded; the lock, the streams and the files are already closed.
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
    super::pill::recording_started(app);
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

pub fn resume(app: &AppHandle) -> Result<()> {
    let runtime = app.state::<RecorderRuntime>();
    let mut guard = lock(&runtime.inner);
    let rec = guard.as_mut().ok_or(SessionError::NotRecording)?;
    let now = Instant::now();
    rec.resume(now)?;
    emit_state(app, rec.state(now));
    Ok(())
}

/// Stopping a session that is already saving, or no session, does nothing.
/// `only`: stop only if this is still the running session (the watchdog's own stop).
pub fn stop(app: &AppHandle, only: Option<&Path>, reason: StopReason, warning: Option<&'static str>) -> Result<()> {
    let runtime = app.state::<RecorderRuntime>();
    let pending = {
        let mut guard = lock(&runtime.inner);
        let Some(rec) = guard.as_mut() else {
            return Ok(());
        };
        if rec.status == Status::Finishing || only.is_some_and(|d| d != rec.dir.as_path()) {
            return Ok(());
        }
        transition(Some(rec.status), Command::Stop)?;
        if let Some(w) = warning {
            rec.warnings.push(w);
        }
        let now = Instant::now();
        let pending = rec.begin_stop(reason, now);
        emit_state(app, rec.state(now));
        pending
    };
    spawn_save(app.clone(), pending);
    Ok(())
}

pub fn state(app: &AppHandle) -> Option<RecordingStatePayload> {
    app.state::<RecorderRuntime>().state()
}

/// App quit: close the open segment (the folder stays for recovery) and stop a
/// running mux. Bounded, so quitting never hangs.
pub fn shutdown(app: &AppHandle) {
    let Some(runtime) = app.try_state::<RecorderRuntime>() else {
        return;
    };
    for slot in [&runtime.ffmpeg, &runtime.recovery_ffmpeg] {
        if let Some(child) = lock(slot).as_mut() {
            let _ = child.kill();
        }
    }
    let Ok(mut guard) = runtime.inner.try_lock() else {
        return;
    };
    let Some(rec) = guard.as_mut() else {
        return;
    };
    if rec.status == Status::Finishing {
        return;
    }
    let pending = rec.begin_stop(StopReason::User, Instant::now());
    drop(guard);
    if pending.manifest.recv_timeout(Duration::from_secs(2)).is_err() {
        tracing::warn!("the recording writer did not finish before quit");
    }
}

/// Once a second: `recording_state`; stops on a lost device or a failed write,
/// and every 10 s checks the free space (stop and save with `low_disk`).
fn spawn_watchdog(app: AppHandle, dir: PathBuf) {
    std::thread::spawn(move || {
        let mut tick: u64 = 0;
        loop {
            std::thread::sleep(TICK);
            tick += 1;
            let runtime = app.state::<RecorderRuntime>();
            let (active_ms, problem) = {
                let guard = lock(&runtime.inner);
                let Some(rec) = guard.as_ref().filter(|r| r.dir == dir) else {
                    return;
                };
                if rec.status == Status::Finishing {
                    return;
                }
                let state = rec.state(Instant::now());
                emit_state(&app, state);
                let problem = if rec.health.device_lost.load(Ordering::SeqCst) {
                    Some(WARN_DEVICE_LOST)
                } else if rec.health.write_failed.load(Ordering::SeqCst)
                    // The writer ends only on stop: ended earlier means it panicked.
                    || rec.writer.as_ref().is_some_and(|w| w.is_finished())
                {
                    Some(WARN_WRITE_FAILED)
                } else {
                    None
                };
                (state.active_ms, problem)
            };
            if let Some(warning) = problem {
                tracing::warn!("stopping the recording: {warning}");
                if let Err(e) = stop(&app, Some(dir.as_path()), StopReason::User, Some(warning)) {
                    tracing::error!("stop after {warning} failed: {e:#}");
                }
                return;
            }
            if tick.is_multiple_of(DISK_EVERY_TICKS) {
                let Some(free) = disk::free_space(&dir) else {
                    continue;
                };
                if disk::should_stop(free, disk::mux_reserve(&dir, active_ms)) {
                    tracing::warn!("{free} bytes free, stopping the recording");
                    if let Err(e) = stop(&app, Some(dir.as_path()), StopReason::LowDisk, None) {
                        tracing::error!("low-disk stop failed: {e:#}");
                    }
                    return;
                }
            }
        }
    });
}

fn spawn_save(app: AppHandle, pending: PendingSave) {
    std::thread::spawn(move || {
        let dir = pending.dir.clone();
        let outcome = pending.into_job().and_then(|job| {
            let runtime = app.state::<RecorderRuntime>();
            save(job, crate::ffmpeg::find_ffmpeg_path(), &runtime.ffmpeg)
        });
        {
            let runtime = app.state::<RecorderRuntime>();
            let mut guard = lock(&runtime.inner);
            if guard.as_ref().is_some_and(|r| r.dir == dir) {
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
        super::pill::recording_ended(&app);
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

/// Runs ffmpeg with its child kept in `slot`, so a quit can kill it.
fn run_ffmpeg(ffmpeg: &Path, args: &[String], slot: &Mutex<Option<Child>>) -> Result<()> {
    let mut cmd = Process::new(ffmpeg);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().with_context(|| format!("run {}", ffmpeg.display()))?;
    let stderr = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_string(&mut text);
        }
        text
    });
    *lock(slot) = Some(child);
    let status = loop {
        let polled = lock(slot).as_mut().map(|c| c.try_wait());
        match polled {
            None => bail!("ffmpeg was stopped"),
            Some(Ok(Some(status))) => {
                lock(slot).take();
                break status;
            }
            Some(Ok(None)) => std::thread::sleep(Duration::from_millis(50)),
            Some(Err(e)) => {
                lock(slot).take();
                return Err(e).context("wait for ffmpeg");
            }
        }
    };
    let stderr = reader.join().unwrap_or_default();
    if !status.success() {
        let stderr: String = stderr.chars().take(2000).collect();
        bail!("ffmpeg failed ({status}): {}", stderr.trim());
    }
    Ok(())
}

/// Renames the muxed file into place without replacing anything: if a file
/// with that name appeared meanwhile, a new free name is picked (and saved in
/// the manifest before the rename).
fn move_into_place(job: &mut SaveJob, partial: &Path, mut target: PathBuf, ext: &str) -> Result<PathBuf> {
    let mut attempt = 0;
    loop {
        if target.exists() {
            let taken = reserved_names(&job.recordings_dir, &job.dir);
            target = pick_output_path(&job.recordings_dir, &job.stem, ext, &taken);
            job.manifest.finalizing_to = target.file_name().map(|n| n.to_string_lossy().into_owned());
            write_manifest_atomic(&job.dir, &job.manifest)?;
        }
        match std::fs::rename(partial, &target) {
            Ok(()) => return Ok(target),
            // An antivirus or the indexer may hold the fresh file for a moment.
            Err(_) if attempt < 5 => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e).with_context(|| format!("rename to {}", target.display())),
        }
    }
}

fn mux(job: &mut SaveJob, plan: &FinalizePlan, ffmpeg: Option<PathBuf>, slot: &Mutex<Option<Child>>) -> Result<PathBuf> {
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
    run_ffmpeg(&ffmpeg, &args, slot)?;
    if !partial.is_file() {
        bail!("ffmpeg wrote no {}", partial.display());
    }
    record_final_bytes(&job.dir, &mut job.manifest, &partial)?;
    move_into_place(job, &partial, final_path, plan.ext)
}

/// Finalizes a stopped session. Nothing recorded: the working folder is removed
/// and the result is `too_short`. A failed mux keeps the folder for recovery.
fn save(mut job: SaveJob, ffmpeg: Option<PathBuf>, slot: &Mutex<Option<Child>>) -> Result<RecordingFinished, RecordingFailed> {
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
    match mux(&mut job, &plan, ffmpeg, slot) {
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
                warning: job.warnings.first().map(|w| (*w).to_string()),
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

/// Error text of `recover` when nothing was left to recover (the folder is removed);
/// the frontend tells it apart by this prefix.
pub const NOTHING_TO_RECOVER: &str = "too_short: nothing was recorded";

fn finished_recovery(path: &Path, plan: Option<&FinalizePlan>) -> RecordingFinished {
    RecordingFinished {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        duration_seconds: plan.map(plan_seconds).unwrap_or(0.0),
        has_video: plan.is_some_and(|p| !p.video.is_empty()),
        warning: None,
        stop_reason: StopReason::User,
        recovered: true,
    }
}

/// Recovers one unfinished folder: closes its segments from the disk and saves the
/// same way a normal stop does (same file name rules, `Записи/`). A final file that is
/// already in place only gets its working folder removed. Blocking.
fn recover_dir(
    dir: &Path,
    active: &[PathBuf],
    ffmpeg: Option<PathBuf>,
    slot: &Mutex<Option<Child>>,
) -> Result<RecordingFinished> {
    ensure_session_dir(dir)?;
    let recordings_dir = dir.parent().context("recordings folder")?.to_path_buf();
    let probe = |file: &Path| ffmpeg.as_deref().and_then(|ff| probe_video_seconds(ff, file));
    match prepare_recovery(dir, active, probe)? {
        RecoveryAction::AlreadyFinished(path) => {
            let plan = read_manifest(dir).ok().and_then(|m| finalize_plan(&m).ok());
            if let Err(e) = remove_working_dir(dir, &path, active) {
                tracing::warn!("{e:#}");
            }
            Ok(finished_recovery(&path, plan.as_ref()))
        }
        RecoveryAction::Finalize(manifest) => {
            let plan = match finalize_plan(&manifest) {
                Ok(plan) => plan,
                Err(FinalizeError::Empty) => {
                    discard_unfinished(dir, active)?;
                    bail!("{}", NOTHING_TO_RECOVER);
                }
            };
            let lock = SessionLock::acquire(dir)?;
            let stem = if manifest.name.trim().is_empty() {
                "Запись".to_string()
            } else {
                manifest.name.clone()
            };
            let mut job = SaveJob {
                dir: dir.to_path_buf(),
                recordings_dir,
                stem,
                manifest,
                lock: Some(lock),
                stop_reason: StopReason::User,
                warnings: Vec::new(),
            };
            let final_path = mux(&mut job, &plan, ffmpeg, slot)?;
            drop(job.lock.take());
            if let Err(e) = remove_working_dir(dir, &final_path, &[]) {
                tracing::warn!("{e:#}");
            }
            Ok(finished_recovery(&final_path, Some(&plan)))
        }
    }
}

/// Command side of "Восстановить": runs `recover_dir` and announces the file as `recording_finished`.
pub fn recover(app: &AppHandle, dir: &Path) -> Result<()> {
    let runtime = app.state::<RecorderRuntime>();
    let _guard = runtime.begin_recovery(dir)?;
    let active = runtime.session_dirs();
    let finished = recover_dir(dir, &active, crate::ffmpeg::find_ffmpeg_path(), &runtime.recovery_ffmpeg)?;
    app.emit(FINISHED_EVENT, &finished).context("emit recording_finished")
}

/// Command side of "Удалить".
pub fn discard(app: &AppHandle, dir: &Path) -> Result<()> {
    let runtime = app.state::<RecorderRuntime>();
    let _guard = runtime.begin_recovery(dir)?;
    discard_unfinished(dir, &runtime.session_dirs())
}

/// Unfinished recordings in `recordings_dir`, without the live session and the ones being recovered.
pub fn unfinished(app: &AppHandle, recordings_dir: &Path) -> Vec<super::recovery::UnfinishedRecording> {
    let runtime = app.state::<RecorderRuntime>();
    super::recovery::scan_unfinished(recordings_dir, &runtime.active_dirs())
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
        Segments::new(
            dir.to_path_buf(),
            manifest(),
            vec![Track {
                source: AudioSource::Mic,
                sink: SegmentedWavSink::new(AudioSource::Mic, 1_000, 1),
            }],
        )
    }

    fn feed(s: &mut Segments, frames: usize, at: Instant) {
        s.tracks[0].sink.write(&vec![0.25; frames], at);
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

    fn no_child() -> Mutex<Option<Child>> {
        Mutex::new(None)
    }

    #[test]
    fn pause_closes_the_segment_at_its_active_length() {
        let root = tempfile::tempdir().unwrap();
        let dir = create_session_dir(root.path(), "2026-10-31 14-05-33").unwrap();
        let mut s = mic_session(&dir);
        let t0 = Instant::now();
        s.open_segment(t0).unwrap();
        assert!(!read_manifest(&dir).unwrap().segments[0].closed);
        feed(&mut s, 500, t0);
        s.close_segment(t0 + Duration::from_millis(500)).unwrap();
        // paused for 30 s: nothing is written, the next segment starts on resume
        feed(&mut s, 100, t0 + Duration::from_secs(10));
        let t1 = t0 + Duration::from_secs(30);
        s.open_segment(t1).unwrap();
        feed(&mut s, 300, t1);
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
    fn a_long_segment_asks_for_rotation() {
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
    fn the_callback_only_enqueues_even_after_a_long_silence() {
        let health = Arc::new(Health::default());
        let (mut sender, input) = source_queue(48_000, 2, health.clone());
        let t0 = Instant::now();
        // the first block after ten silent minutes: one block in the queue, nothing else
        sender.push(&[0.5; 960], t0 + Duration::from_secs(600));
        let block = input.blocks.try_recv().unwrap();
        assert_eq!(block.samples.len(), 960);
        assert_eq!(block.start, t0 + Duration::from_secs(600) - Duration::from_millis(10));
        assert!(input.blocks.try_recv().is_err());
        // a returned buffer is reused instead of allocating
        input.spares.try_send(block.samples).unwrap();
        sender.push(&[0.25; 4], t0);
        assert!(input.spares.try_send(Vec::new()).is_ok());
        // a full queue drops the block and counts it, without waiting
        for _ in 0..BLOCK_QUEUE {
            sender.push(&[0.0; 2], t0);
        }
        assert_eq!(health.dropped_frames.load(Ordering::Relaxed), 1);
    }

    fn writer_with(dir: &Path, sources: &[AudioSource]) -> (Writer, Vec<BlockSender>, Sender<Ctl>, Arc<Health>) {
        let health = Arc::new(Health::default());
        let mut tracks = Vec::new();
        let mut inputs = Vec::new();
        let mut senders = Vec::new();
        for &source in sources {
            let (sender, input) = source_queue(1_000, 1, health.clone());
            tracks.push(Track {
                source,
                sink: SegmentedWavSink::new(source, 1_000, 1),
            });
            inputs.push(input);
            senders.push(sender);
        }
        let (ctl_tx, ctl_rx) = mpsc::channel();
        let segments = Segments::new(dir.to_path_buf(), manifest(), tracks);
        let writer = Writer::new(segments, inputs, health.clone(), ctl_rx, Instant::now());
        (writer, senders, ctl_tx, health)
    }

    /// A mic session armed at `t0`, its first segment open at `t0`.
    fn mic_writer(dir: &Path) -> (Writer, BlockSender, Arc<Health>, Instant) {
        let (mut w, mut senders, _ctl, health) = writer_with(dir, &[AudioSource::Mic]);
        let t0 = Instant::now();
        w.arm(t0);
        w.segments.open_segment(t0).unwrap();
        (w, senders.remove(0), health, t0)
    }

    fn lost(h: &Health) -> bool {
        h.device_lost.load(Ordering::SeqCst)
    }

    #[test]
    fn a_slow_mic_has_ten_seconds_for_its_first_block() {
        let root = tempfile::tempdir().unwrap();
        let (mut w, mut mic, health, t0) = mic_writer(root.path());
        for s in 1..=4 {
            w.tick(t0 + Duration::from_secs(s));
        }
        assert!(!lost(&health));
        // first block at 4 s (Bluetooth hands-free switch), then it flows
        for i in 0..100u64 {
            let at = t0 + Duration::from_millis(4_000 + 20 * (i + 1));
            mic.push(&[0.5; 20], at);
            w.tick(at);
        }
        w.tick(t0 + Duration::from_millis(6_500));
        assert!(!lost(&health));
    }

    #[test]
    fn a_mic_that_never_sends_is_lost_after_ten_seconds() {
        let root = tempfile::tempdir().unwrap();
        let (mut w, _mic, health, t0) = mic_writer(root.path());
        w.tick(t0 + Duration::from_secs(9));
        assert!(!lost(&health));
        w.tick(t0 + Duration::from_secs(11));
        assert!(lost(&health));
    }

    #[test]
    fn a_mic_that_flowed_and_went_quiet_for_three_and_a_half_seconds_is_lost() {
        let root = tempfile::tempdir().unwrap();
        let (mut w, mut mic, health, t0) = mic_writer(root.path());
        let last = t0 + Duration::from_secs(1);
        mic.push(&[0.5; 20], last);
        w.tick(last);
        // the block started at 0.98 s
        w.tick(last + Duration::from_millis(2_500));
        assert!(!lost(&health));
        w.tick(last + Duration::from_millis(3_500));
        assert!(lost(&health));
    }

    #[test]
    fn resume_gives_the_mic_a_fresh_grace_window() {
        let root = tempfile::tempdir().unwrap();
        let (mut w, mut mic, health, t0) = mic_writer(root.path());
        mic.push(&[0.5; 20], t0 + Duration::from_secs(1));
        w.tick(t0 + Duration::from_secs(1));
        w.segments.close_segment(t0 + Duration::from_secs(1)).unwrap();
        // paused for a minute, then resumed: the mic gets 10 s again
        let resumed = t0 + Duration::from_secs(61);
        w.segments.open_segment(resumed).unwrap();
        w.arm(resumed);
        w.tick(resumed + Duration::from_secs(5));
        assert!(!lost(&health));
        w.tick(resumed + Duration::from_secs(11));
        assert!(lost(&health));
    }

    #[test]
    fn a_sink_that_fails_again_right_after_rotation_stops_the_session() {
        let root = tempfile::tempdir().unwrap();
        let (mut w, mut mic, health, t0) = mic_writer(root.path());
        let mut feed_until = |w: &mut Writer, ms: u64| {
            let at = t0 + Duration::from_millis(ms);
            mic.push(&[0.5; 20], at);
            w.tick(at);
        };
        feed_until(&mut w, 20);
        w.segments.tracks[0].sink.fail_for_test();
        feed_until(&mut w, 40);
        assert_eq!(w.segments.manifest.segments.len(), 2);
        assert!(!health.write_failed.load(Ordering::SeqCst));
        // fails again a second later: no third segment, the session is stopped
        w.segments.tracks[0].sink.fail_for_test();
        feed_until(&mut w, 1_040);
        feed_until(&mut w, 1_060);
        assert_eq!(w.segments.manifest.segments.len(), 2);
        assert!(health.write_failed.load(Ordering::SeqCst));
    }

    #[test]
    fn the_writer_fills_silent_loopback_as_time_goes_and_reports_a_stalled_mic() {
        let root = tempfile::tempdir().unwrap();
        let (mut w, mut senders, _ctl, health) = writer_with(root.path(), &[AudioSource::Mic, AudioSource::System]);
        let t0 = Instant::now();
        w.segments.open_segment(t0).unwrap();
        // the mic talks for 2 s, the loopback stays silent
        for i in 0..100u64 {
            let at = t0 + Duration::from_millis(20 * (i + 1));
            senders[0].push(&[0.5; 20], at);
            w.tick(at);
        }
        let system = w.segments.tracks[1].sink.has_failed();
        assert!(!system);
        w.tick(t0 + Duration::from_millis(2_000));
        assert!(!health.device_lost.load(Ordering::SeqCst));
        // then the mic goes quiet for more than 3 s: gone
        w.tick(t0 + Duration::from_millis(5_100));
        assert!(health.device_lost.load(Ordering::SeqCst));

        w.segments.close_segment(t0 + Duration::from_millis(5_100)).unwrap();
        let audio = &w.segments.manifest.segments[0].audio;
        assert_eq!(audio[0].captured_frames, 2_000);
        // the loopback was filled with silence along the way and padded to the length
        assert_eq!((audio[1].captured_frames, audio[1].frames), (0, 5_100));
    }

    #[test]
    fn pause_and_finish_go_through_the_writer() {
        let root = tempfile::tempdir().unwrap();
        let (mut w, mut senders, ctl, _health) = writer_with(root.path(), &[AudioSource::Mic]);
        let t0 = Instant::now();
        w.segments.open_segment(t0).unwrap();
        senders[0].push(&[0.5; 500], t0 + Duration::from_millis(500));
        let handle = std::thread::spawn(move || w.run());
        ctl.send(Ctl::Pause(t0 + Duration::from_millis(500))).unwrap();
        ctl.send(Ctl::Resume(t0 + Duration::from_secs(10))).unwrap();
        let (tx, rx) = mpsc::channel();
        ctl.send(Ctl::Finish(t0 + Duration::from_millis(10_200), tx)).unwrap();
        let m = rx.recv_timeout(Duration::from_secs(10)).unwrap();
        handle.join().unwrap();
        let lengths: Vec<(u64, bool)> = m.segments.iter().map(|g| (g.wall_ms, g.closed)).collect();
        assert_eq!(lengths, vec![(500, true), (200, true)]);
        assert_eq!(m.segments[0].audio[0].captured_frames, 500);
        assert_eq!(read_manifest(root.path()).unwrap(), m);
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
        let failed = save(job(root.path(), &s, Some(session_lock)), None, &no_child()).unwrap_err();
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
        feed(&mut s, 1_000, t0);
        s.close_segment(t0 + Duration::from_secs(1)).unwrap();
        let missing = root.path().join("no-ffmpeg-here");
        let failed = save(job(root.path(), &s, None), Some(missing), &no_child()).unwrap_err();
        assert_eq!(failed.code, FailCode::Encoder);
        assert!(dir.join("seg-0001.mic.wav").is_file());
        let m = read_manifest(&dir).unwrap();
        assert_eq!(m.finalizing_to.as_deref(), Some("2026-10-31 14-05-33.m4a"));
        assert_eq!(m.final_bytes, None);
        assert!(!root.path().join("2026-10-31 14-05-33.m4a").exists());
    }

    /// A session folder with one closed second of mic audio, as left by a crash.
    fn crashed_session(root: &Path, seconds: u64) -> PathBuf {
        let dir = create_session_dir(root, "2026-10-31 14-05-33").unwrap();
        let mut s = mic_session(&dir);
        let t0 = Instant::now();
        s.open_segment(t0).unwrap();
        feed(&mut s, (seconds * 1_000) as usize, t0);
        s.close_segment(t0 + Duration::from_secs(seconds)).unwrap();
        dir
    }

    #[test]
    fn recovery_of_a_finished_file_only_removes_the_folder() {
        let root = tempfile::tempdir().unwrap();
        let dir = crashed_session(root.path(), 2);
        let mut m = read_manifest(&dir).unwrap();
        m.finalizing_to = Some("2026-10-31 14-05-33.m4a".into());
        m.final_bytes = Some(4);
        write_manifest_atomic(&dir, &m).unwrap();
        let final_file = root.path().join("2026-10-31 14-05-33.m4a");
        std::fs::write(&final_file, b"done").unwrap();

        let finished = recover_dir(&dir, &[], None, &no_child()).unwrap();
        assert!(finished.recovered);
        assert_eq!(finished.path, final_file.to_string_lossy());
        assert_eq!(finished.name, "2026-10-31 14-05-33.m4a");
        assert!(!dir.exists());
        // no second file appeared
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn recovery_with_nothing_recorded_removes_the_folder_and_says_so() {
        let root = tempfile::tempdir().unwrap();
        let dir = create_session_dir(root.path(), "2026-10-31 14-05-33").unwrap();
        let mut s = mic_session(&dir);
        let t0 = Instant::now();
        s.open_segment(t0).unwrap();
        s.close_segment(t0 + Duration::from_millis(300)).unwrap();
        let err = recover_dir(&dir, &[], None, &no_child()).unwrap_err();
        assert!(format!("{err:#}").starts_with("too_short"));
        assert!(!dir.exists());
    }

    #[test]
    fn a_failed_recovery_keeps_the_folder_and_a_live_session_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let dir = crashed_session(root.path(), 2);
        let missing = root.path().join("no-ffmpeg-here");
        assert!(recover_dir(&dir, &[], Some(missing.clone()), &no_child()).is_err());
        assert!(dir.join("seg-0001.mic.wav").is_file());
        // the folder of the live session is not touched
        assert!(recover_dir(&dir, std::slice::from_ref(&dir), Some(missing), &no_child()).is_err());
        assert!(dir.join("manifest.json").is_file());
    }

    #[test]
    fn a_folder_is_recovered_by_one_caller_at_a_time() {
        let runtime = RecorderRuntime::default();
        let dir = PathBuf::from("rec/.tyto-rec-1");
        let first = runtime.begin_recovery(&dir).unwrap();
        assert!(runtime.begin_recovery(&dir).is_err());
        assert_eq!(runtime.active_dirs(), vec![dir.clone()]);
        drop(first);
        assert!(runtime.active_dirs().is_empty());
        assert!(runtime.begin_recovery(&dir).is_ok());
    }

    #[test]
    fn the_final_file_never_replaces_one_that_appeared_meanwhile() {
        let root = tempfile::tempdir().unwrap();
        let dir = create_session_dir(root.path(), "2026-10-31 14-05-33").unwrap();
        let s = mic_session(&dir);
        let mut j = job(root.path(), &s, None);
        let partial = dir.join("final.partial.m4a");
        std::fs::write(&partial, b"ours").unwrap();
        let target = root.path().join("2026-10-31 14-05-33.m4a");
        std::fs::write(&target, b"someone else's").unwrap();
        let placed = move_into_place(&mut j, &partial, target.clone(), "m4a").unwrap();
        assert_eq!(placed, root.path().join("2026-10-31 14-05-33 (1).m4a"));
        assert_eq!(std::fs::read(&target).unwrap(), b"someone else's");
        assert_eq!(std::fs::read(&placed).unwrap(), b"ours");
        assert_eq!(
            read_manifest(&dir).unwrap().finalizing_to.as_deref(),
            Some("2026-10-31 14-05-33 (1).m4a")
        );
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
    fn a_lost_device_is_told_apart_from_other_stream_errors() {
        assert!(is_device_lost(cpal::ErrorKind::DeviceNotAvailable));
        assert!(is_device_lost(cpal::ErrorKind::StreamInvalidated));
        assert!(!is_device_lost(cpal::ErrorKind::Xrun));
        assert!(!is_device_lost(cpal::ErrorKind::DeviceChanged));
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
            warning: Some(WARN_DEVICE_LOST.into()),
            stop_reason: StopReason::LowDisk,
            recovered: false,
        })
        .unwrap();
        assert_eq!(finished["stopReason"], "low_disk");
        assert_eq!(finished["durationSeconds"], 65.0);
        assert_eq!(finished["warning"], "device_lost");
        assert_eq!(finished["hasVideo"], serde_json::json!(false));
        let failed = serde_json::to_value(RecordingFailed {
            code: FailCode::TooShort,
            message: "m".into(),
        })
        .unwrap();
        assert_eq!(failed["code"], "too_short");
    }
}
