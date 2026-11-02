//! One video segment: an ffmpeg process fed raw BGRA frames at a constant rate.
//!
//! A pacing thread writes the latest captured frame every `1/fps` as many times as
//! `FramePacer::due` says, so the file has exactly `floor(active time * fps)`
//! frames whatever the capture delivers: no new frames (a static screen, a
//! minimized or closed window) repeat the last one, black is written until the
//! first frame arrives.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use eyre::{bail, Context, ContextCompat, Result};

use super::encoder::{video_segment_args, VideoEncoder};
use super::frame::{Frame, LatestFrame};
use super::pacer::FramePacer;
use super::quality::Preset;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// How long `close` waits for the pacing thread and then for ffmpeg.
const CLOSE_WAIT: Duration = Duration::from_secs(15);
/// The pacer falling this far behind the clock means the encoder is too slow.
const LAG_WARNING: Duration = Duration::from_secs(2);
/// This far behind, the encoder counts as failed: the session moves to the next
/// one instead of piling up a backlog that the close would have to write out.
const LAG_FAILURE: Duration = Duration::from_secs(10);
/// Upper bound of one sleep, so a close is noticed quickly.
const MAX_SLEEP: Duration = Duration::from_millis(50);
const STDERR_KEEP: usize = 2000;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

type SharedChild = Arc<Mutex<Child>>;

/// Every segment ffmpeg alive now, so quitting the app can kill them.
static LIVE: Mutex<Vec<(u64, SharedChild)>> = Mutex::new(Vec::new());
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Kills every segment ffmpeg still running (app quit).
pub fn kill_all() {
    for (_, child) in lock(&LIVE).drain(..) {
        let _ = lock(&child).kill();
    }
}

/// What a closed segment holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Written {
    pub frames: u64,
    /// At least one captured frame (not the black filler) went into the file.
    pub real: bool,
}

pub struct VideoSegmentWriter {
    pub encoder: VideoEncoder,
    pub file: PathBuf,
    id: u64,
    child: SharedChild,
    stop_at: Arc<Mutex<Option<Instant>>>,
    failed: Arc<AtomicBool>,
    /// Frames the pacer has counted so far (updated under `stop_at`).
    counted: Arc<AtomicU64>,
    fps: u32,
    segment_start: Instant,
    thread: Option<JoinHandle<Result<Written>>>,
    stderr: Option<JoinHandle<String>>,
}

impl VideoSegmentWriter {
    /// Starts ffmpeg writing `out` and the pacing thread; `segment_start` is time zero of the segment.
    pub fn start(
        ffmpeg: &Path,
        enc: VideoEncoder,
        p: &Preset,
        size: (u32, u32),
        out: &Path,
        latest: LatestFrame,
        segment_start: Instant,
    ) -> Result<Self> {
        if p.fps == 0 || size.0 == 0 || size.1 == 0 {
            bail!("bad video settings: {} fps, {}x{}", p.fps, size.0, size.1);
        }
        let mut cmd = Command::new(ffmpeg);
        cmd.args(video_segment_args(enc, p, size, out))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let mut child = cmd.spawn().with_context(|| format!("run {}", ffmpeg.display()))?;
        let stdin = child.stdin.take().context("ffmpeg stdin")?;
        let stderr = child.stderr.take().map(|mut pipe| {
            std::thread::spawn(move || {
                let mut text = Vec::new();
                let _ = pipe.read_to_end(&mut text);
                let text = String::from_utf8_lossy(&text);
                let skip = text.chars().count().saturating_sub(STDERR_KEEP);
                text.chars().skip(skip).collect::<String>()
            })
        });
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let child = Arc::new(Mutex::new(child));
        lock(&LIVE).push((id, child.clone()));

        let stop_at = Arc::new(Mutex::new(None));
        let failed = Arc::new(AtomicBool::new(false));
        let counted = Arc::new(AtomicU64::new(0));
        let pacing = Pacing {
            stdin,
            latest,
            size,
            fps: p.fps,
            segment_start,
            stop_at: stop_at.clone(),
            failed: failed.clone(),
            counted: counted.clone(),
        };
        let thread = std::thread::Builder::new()
            .name("tyto-video-writer".into())
            .spawn(move || pacing.run());
        let thread = match thread {
            Ok(t) => t,
            Err(e) => {
                let _ = lock(&child).kill();
                unregister(id);
                return Err(e).context("start the video writer");
            }
        };
        Ok(Self {
            encoder: enc,
            file: out.to_path_buf(),
            id,
            child,
            stop_at,
            failed,
            counted,
            fps: p.fps,
            segment_start,
            thread: Some(thread),
            stderr,
        })
    }

    /// ffmpeg stopped taking frames (it died or the pipe broke).
    pub fn has_failed(&self) -> bool {
        self.failed.load(Ordering::SeqCst)
            || (lock(&self.stop_at).is_none() && self.thread.as_ref().is_some_and(|t| t.is_finished()))
    }

    /// The segment ends at `at` (pause, rotation, stop): frames due by then are
    /// still written by `close`. Without it, `close` ends the segment when called.
    /// Returns the frames the file will hold: those due by `at`, or more if the
    /// pacer already went past `at` before the stop reached it (it runs on real
    /// time). The pacer counts under the same lock, so the number is exact and
    /// the sound can be cut to it.
    pub fn finish_at(&self, at: Instant) -> u64 {
        let mut stop = lock(&self.stop_at);
        let at = *stop.get_or_insert(at);
        let elapsed = at.saturating_duration_since(self.segment_start);
        let due = (elapsed.as_nanos() * u128::from(self.fps) / 1_000_000_000) as u64;
        due.max(self.counted.load(Ordering::SeqCst))
    }

    /// Closes stdin, waits for ffmpeg and returns the frames written, and whether
    /// a captured frame was among them (else only black filler). ffmpeg dead → `Err`.
    /// Blocking (up to 2 × 15 s on a hung encoder): not on the audio writer thread.
    pub fn close(mut self) -> Result<Written> {
        self.finish_at(Instant::now());
        let thread = self.thread.take();
        let written = match thread {
            Some(t) => {
                let deadline = Instant::now() + CLOSE_WAIT;
                while !t.is_finished() && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(10));
                }
                if !t.is_finished() {
                    // A stuck encoder blocks the pipe: killing it unblocks the write.
                    tracing::error!("the video encoder does not take frames, stopping it");
                    let _ = lock(&self.child).kill();
                }
                t.join().unwrap_or_else(|_| Err(eyre::eyre!("the video writer panicked")))
            }
            None => Err(eyre::eyre!("the video writer did not start")),
        };
        let status = self.wait_child();
        unregister(self.id);
        // ffmpeg is gone, so its stderr is at its end.
        let stderr = self
            .stderr
            .take()
            .and_then(|t| t.join().ok())
            .unwrap_or_default()
            .trim()
            .to_string();
        let written = written.map_err(|e| eyre::eyre!("{e:#}; ffmpeg: {stderr}"))?;
        match status {
            Some(st) if st.success() => {}
            Some(st) => bail!("ffmpeg failed ({st}): {stderr}"),
            None => bail!("ffmpeg did not finish the segment"),
        }
        Ok(written)
    }

    fn wait_child(&self) -> Option<std::process::ExitStatus> {
        let deadline = Instant::now() + CLOSE_WAIT;
        loop {
            match lock(&self.child).try_wait() {
                Ok(Some(st)) => return Some(st),
                Ok(None) if Instant::now() < deadline => {}
                _ => {
                    let mut c = lock(&self.child);
                    let _ = c.kill();
                    let _ = c.wait();
                    return None;
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for VideoSegmentWriter {
    fn drop(&mut self) {
        // Not closed (a panic on the way): do not leave ffmpeg behind.
        if self.thread.is_some() {
            self.finish_at(Instant::now());
            let _ = lock(&self.child).kill();
            unregister(self.id);
        }
    }
}

fn unregister(id: u64) {
    lock(&LIVE).retain(|(i, _)| *i != id);
}

struct Pacing {
    stdin: ChildStdin,
    latest: LatestFrame,
    size: (u32, u32),
    fps: u32,
    segment_start: Instant,
    stop_at: Arc<Mutex<Option<Instant>>>,
    failed: Arc<AtomicBool>,
    counted: Arc<AtomicU64>,
}

impl Pacing {
    fn run(mut self) -> Result<Written> {
        let result = self.pace();
        if result.is_err() {
            self.failed.store(true, Ordering::SeqCst);
        }
        // Dropping stdin (with `self`) lets ffmpeg finish the file.
        result
    }

    fn pace(&mut self) -> Result<Written> {
        let mut pacer = FramePacer::new(self.fps);
        let mut picture = Frame::black(self.size.0, self.size.1);
        let mut real = false;
        let mut lag_warned = false;
        let frame_ns = 1_000_000_000 / u64::from(self.fps);
        loop {
            // Counted under the stop lock: `finish_at` sees either the stop applied
            // here, or every frame counted before it.
            let (stop, n) = {
                let guard = lock(&self.stop_at);
                let stop = *guard;
                let now = stop.unwrap_or_else(Instant::now);
                let n = pacer.due(now.saturating_duration_since(self.segment_start));
                self.counted.store(pacer.frames(), Ordering::SeqCst);
                (stop, n)
            };
            if n > 0 {
                if let Some(f) = lock(&self.latest).as_ref() {
                    if (f.width, f.height) == self.size && f.data.len() == picture.data.len() {
                        picture.data.copy_from_slice(&f.data);
                        real = true;
                    }
                }
                for _ in 0..n {
                    self.stdin.write_all(&picture.data).context("write a frame to ffmpeg")?;
                }
            }
            if stop.is_some() {
                self.stdin.flush().context("flush ffmpeg stdin")?;
                return Ok(Written {
                    frames: pacer.frames(),
                    real,
                });
            }
            // Next frame boundary on the absolute clock: no drift from sleeps.
            let next = self.segment_start + Duration::from_nanos((pacer.frames() + 1).saturating_mul(frame_ns));
            let now = Instant::now();
            let lag = now.saturating_duration_since(next);
            if !lag_warned && lag > LAG_WARNING {
                lag_warned = true;
                tracing::warn!("the video encoder is slower than real time");
            }
            if lag > LAG_FAILURE {
                bail!("the video encoder is {} s behind real time", lag.as_secs());
            }
            let wait = next.saturating_duration_since(now).clamp(Duration::from_millis(1), MAX_SLEEP);
            std::thread::sleep(wait);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::encoder::test_support::{test_encoder, usable_ffmpeg};
    use super::super::quality::{preset, Quality};
    use super::super::recovery::probe_video_seconds;
    use super::*;

    #[test]
    fn writer_keeps_the_rate_without_frames_and_tells_black_filler_apart() {
        let Some(ffmpeg) = usable_ffmpeg() else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let p = preset(Quality::Good);
        let latest: LatestFrame = Arc::new(Mutex::new(None));
        let start = Instant::now();
        let out = dir.path().join("seg-0001.mp4");
        let w = VideoSegmentWriter::start(&ffmpeg, test_encoder(), &p, (320, 180), &out, latest.clone(), start).unwrap();
        std::thread::sleep(Duration::from_millis(400));
        w.finish_at(start + Duration::from_millis(400));
        // only black filler so far: frames, but none captured
        let black = w.close().unwrap();
        assert!(!black.real && (6..=7).contains(&black.frames), "{black:?}");

        let out = dir.path().join("seg-0002.mp4");
        let start = Instant::now();
        let w = VideoSegmentWriter::start(&ffmpeg, test_encoder(), &p, (320, 180), &out, latest.clone(), start).unwrap();
        *lock(&latest) = Some(Frame::black(320, 180));
        // no new frames for a second: the last one is repeated
        std::thread::sleep(Duration::from_millis(1000));
        // the stop comes late (as a close on the busy audio thread would): the
        // promise covers what the pacer already wrote past it
        std::thread::sleep(Duration::from_millis(150));
        let promised = w.finish_at(start + Duration::from_millis(1000));
        let written = w.close().unwrap();
        assert_eq!(written.frames, promised);
        assert!(written.real);
        let frames = written.frames;
        // 17 by real time at 1.15 s (15 due by the stop); a busy runner may be a frame off
        assert!((15..=19).contains(&frames), "{frames}");
        let secs = probe_video_seconds(&ffmpeg, &out).unwrap();
        assert!(
            (secs - frames as f64 / 15.0).abs() <= 1.0 / 15.0 + 0.001,
            "{secs} s for {frames} frames"
        );
    }

    #[test]
    fn dead_ffmpeg_is_an_error() {
        let Some(ffmpeg) = usable_ffmpeg() else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let latest: LatestFrame = Arc::new(Mutex::new(Some(Frame::black(64, 64))));
        // a folder that does not exist: ffmpeg exits at once
        let out = dir.path().join("missing").join("seg.mp4");
        let w = VideoSegmentWriter::start(
            &ffmpeg,
            test_encoder(),
            &preset(Quality::Good),
            (64, 64),
            &out,
            latest,
            Instant::now(),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !w.has_failed() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(w.has_failed());
        let id = w.id;
        assert!(w.close().is_err());
        assert!(lock(&LIVE).iter().all(|(i, _)| *i != id));
    }
}
