//! Recovery of recordings left unfinished by a crash.
//!
//! Save order (Task 7 follows it): write `finalizing_to` into the manifest →
//! ffmpeg writes `final.partial.<ext>` inside the working folder → rename it to
//! `finalizing_to` → remove the working folder. A crash anywhere in that chain
//! leaves either a working folder to finalize again, or a finished file plus a
//! stale working folder: then recovery only removes the folder (no duplicate).

use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use eyre::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::quality::preset;
use super::segments::{
    align_audio, read_manifest, segment_file, segment_ms, strip_verbatim, write_manifest_atomic, AudioSource, AudioTrackRecord,
    Manifest, SegmentRecord, MANIFEST_VERSION, SESSION_PREFIX,
};
use super::session::Mode;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnfinishedRecording {
    pub dir: String,
    pub name: String,
    pub started_at: String,
    pub approx_seconds: u64,
    pub mode: Mode,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RecoveryAction {
    /// The final file is already in place: only the working folder is left to remove.
    AlreadyFinished(PathBuf),
    /// Finalize this manifest again.
    Finalize(Manifest),
}

const SOURCES: [AudioSource; 2] = [AudioSource::Mic, AudioSource::System];

/// Session folders (`.tyto-rec-*`) with a readable manifest, newest first.
/// A folder without one is skipped with a warning.
pub fn scan_unfinished(recordings_dir: &Path) -> Vec<UnfinishedRecording> {
    let Ok(entries) = std::fs::read_dir(recordings_dir) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        let is_session = entry.file_name().to_string_lossy().starts_with(SESSION_PREFIX);
        if !is_session || !dir.is_dir() {
            continue;
        }
        let m = match read_manifest(&dir) {
            Ok(m) if m.version <= MANIFEST_VERSION => m,
            Ok(m) => {
                tracing::warn!("skipping {}: manifest version {} is newer", dir.display(), m.version);
                continue;
            }
            Err(e) => {
                tracing::warn!("skipping {}: {e:#}", dir.display());
                continue;
            }
        };
        found.push(UnfinishedRecording {
            dir: dir.to_string_lossy().into_owned(),
            approx_seconds: approx_ms(&dir, &m) / 1000,
            name: m.name,
            started_at: m.started_at,
            mode: m.mode,
        });
    }
    found.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    found
}

fn approx_ms(dir: &Path, m: &Manifest) -> u64 {
    let closed: u64 = m.segments.iter().filter(|s| s.closed).map(|s| segment_ms(m, s)).sum();
    let open: u64 = m
        .segments
        .iter()
        .filter(|s| !s.closed)
        .map(|s| disk_audio_ms(dir, s.index).unwrap_or(s.wall_ms))
        .sum();
    let orphans: u64 = orphan_indexes(dir, m).into_iter().filter_map(|i| disk_audio_ms(dir, i)).sum();
    closed + open + orphans
}

/// Longest audio of a segment as it is on disk (headers are not trusted).
fn disk_audio_ms(dir: &Path, index: u32) -> Option<u64> {
    SOURCES
        .iter()
        .filter_map(|src| {
            let mut f = File::open(dir.join(segment_file(index, &format!("{}.wav", src.name())))).ok()?;
            let len = f.metadata().ok()?.len();
            let l = wav_layout(&mut f, len).ok()??;
            if l.sample_rate == 0 {
                return None;
            }
            let frames = (len - l.data_start) / l.block_align;
            Some(frames * 1000 / u64::from(l.sample_rate))
        })
        .max()
}

struct WavLayout {
    /// Offset of the first sample (right after the `data` chunk header).
    data_start: u64,
    block_align: u64,
    sample_rate: u32,
    channels: u16,
}

fn le16(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn le32(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

/// Where the samples start. `None`: the file ends before the `data` chunk does.
fn wav_layout(f: &mut File, len: u64) -> Result<Option<WavLayout>> {
    if len < 12 {
        return Ok(None);
    }
    let mut head = [0u8; 12];
    f.seek(SeekFrom::Start(0))?;
    f.read_exact(&mut head)?;
    if &head[0..4] != b"RIFF" || &head[8..12] != b"WAVE" {
        bail!("not a WAV file");
    }
    let mut pos = 12u64;
    let mut fmt: Option<(u16, u32, u16)> = None;
    loop {
        if pos + 8 > len {
            return Ok(None);
        }
        let mut chunk = [0u8; 8];
        f.seek(SeekFrom::Start(pos))?;
        f.read_exact(&mut chunk)?;
        let size = u64::from(le32(&chunk, 4));
        let body = pos + 8;
        match &chunk[0..4] {
            b"data" => {
                let Some((channels, sample_rate, block_align)) = fmt else {
                    bail!("WAV data chunk before fmt");
                };
                if block_align == 0 {
                    bail!("WAV block align is zero");
                }
                return Ok(Some(WavLayout {
                    data_start: body,
                    block_align: u64::from(block_align),
                    sample_rate,
                    channels,
                }));
            }
            b"fmt " => {
                if size < 16 || body + 16 > len {
                    return Ok(None);
                }
                let mut b = [0u8; 16];
                f.read_exact(&mut b)?;
                fmt = Some((le16(&b, 2), le32(&b, 4), le16(&b, 12)));
            }
            _ => {}
        }
        // chunks are padded to an even size
        pos = body + size + (size & 1);
    }
}

/// Rewrites the RIFF and `data` sizes from the data that reached the disk and
/// cuts a trailing partial frame. Returns the layout and the frame count.
fn repair(path: &Path) -> Result<Option<(WavLayout, u64)>> {
    let mut f = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .with_context(|| format!("open {}", path.display()))?;
    let len = f.metadata()?.len();
    let Some(l) = wav_layout(&mut f, len)? else {
        return Ok(None);
    };
    // the RIFF size (file length - 8) must fit u32
    let max_data = u64::from(u32::MAX) - (l.data_start - 8);
    let data = (len - l.data_start).min(max_data);
    let data = data - data % l.block_align;
    set_wav_data_len(&mut f, &l, data)?;
    Ok(Some((data / l.block_align, l)))
}

fn set_wav_data_len(f: &mut File, l: &WavLayout, data: u64) -> Result<()> {
    let end = l.data_start + data;
    f.set_len(end).context("resize WAV")?;
    f.seek(SeekFrom::Start(4))?;
    f.write_all(&((end - 8) as u32).to_le_bytes())?;
    f.seek(SeekFrom::Start(l.data_start - 4))?;
    f.write_all(&(data as u32).to_le_bytes())?;
    f.sync_all().context("sync WAV")?;
    Ok(())
}

/// Fixes a WAV whose writer was never finalized (hound leaves a zero or stale
/// header after a crash). Returns the frame count; a file shorter than its header is 0.
pub fn repair_wav(path: &Path) -> Result<u64> {
    Ok(repair(path)?.map_or(0, |(_, frames)| frames))
}

/// Appends `frames` of silence (all-zero bytes: our segments are f32).
fn pad_wav(path: &Path, l: &WavLayout, frames_now: u64, pad: u64) -> Result<()> {
    let data = (frames_now + pad) * l.block_align;
    if l.data_start - 8 + data > u64::from(u32::MAX) {
        bail!("padded WAV would exceed 4 GB");
    }
    let mut f = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .with_context(|| format!("open {}", path.display()))?;
    set_wav_data_len(&mut f, l, data)
}

/// `HH:MM:SS.xx` → seconds. The fraction is kept as an integer until one final
/// division, so `00:12:03.48` is exactly `723.48`.
fn parse_clock(s: &str) -> Option<f64> {
    let mut parts = s.trim().split(':');
    let (h, m, sec) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    let h: u64 = h.parse().ok()?;
    let m: u64 = m.parse().ok()?;
    let (whole, frac) = sec.split_once('.').unwrap_or((sec, ""));
    let whole: u64 = whole.parse().ok()?;
    let digits = u32::try_from(frac.len()).ok().filter(|d| *d <= 9)?;
    let frac: u64 = if frac.is_empty() { 0 } else { frac.parse().ok()? };
    let scale = 10u64.pow(digits);
    Some(((h * 3600 + m * 60 + whole) * scale + frac) as f64 / scale as f64)
}

/// `Duration: 00:12:03.48, start: ...` → 723.48; `Duration: N/A` → None.
pub fn parse_ffmpeg_duration(stderr: &str) -> Option<f64> {
    let rest = &stderr[stderr.find("Duration:")? + "Duration:".len()..];
    let value = rest.split(',').next()?;
    parse_clock(value)
}

/// Last `time=HH:MM:SS.xx` of the progress lines (how far ffmpeg read).
fn parse_ffmpeg_time(stderr: &str) -> Option<f64> {
    let rest = &stderr[stderr.rfind("time=")? + "time=".len()..];
    let value = rest.split(|c: char| c.is_whitespace()).next()?;
    parse_clock(value)
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(60);

/// Length of a (possibly truncated) fragmented MP4 segment, read with ffmpeg.
/// The header duration of a fragmented file may be missing, so the stream is
/// also read through (`-c copy`, fast) and the longer of the two is taken.
/// Blocking: call from `spawn_blocking`.
pub fn probe_video_seconds(ffmpeg: &Path, file: &Path) -> Option<f64> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-nostdin", "-i"])
        .arg(strip_verbatim(&file.to_string_lossy()))
        .args(["-map", "0:v:0", "-c", "copy", "-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().ok()?;
    let mut stderr = child.stderr.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).into_owned()
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < PROBE_TIMEOUT => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
    // A truncated file may end with an error: what was read still counts.
    let out = reader.join().unwrap_or_default();
    let header = parse_ffmpeg_duration(&out).unwrap_or(0.0);
    let read = parse_ffmpeg_time(&out).unwrap_or(0.0);
    let secs = header.max(read);
    (secs > 0.0).then_some(secs)
}

/// `seg-0003.mp4`, `seg-0003.mic.wav` → 3. Gap fillers and lists are not segments.
fn segment_index(name: &str) -> Option<u32> {
    let (num, kind) = name.strip_prefix("seg-")?.split_once('.')?;
    if !matches!(kind, "mp4" | "mic.wav" | "system.wav") {
        return None;
    }
    num.parse().ok()
}

/// Segments that have files on disk but never reached the manifest (opened, then the crash).
fn orphan_indexes(dir: &Path, m: &Manifest) -> Vec<u32> {
    let known: HashSet<u32> = m.segments.iter().map(|s| s.index).collect();
    let mut found: Vec<u32> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| segment_index(&e.file_name().to_string_lossy()))
                .filter(|i| !known.contains(i))
                .collect()
        })
        .unwrap_or_default();
    found.sort_unstable();
    found.dedup();
    found
}

/// Closes the segments that were open at the crash from what reached the disk:
/// audio frames from the WAV data (headers repaired), `video_frames` from the
/// video length (`floor(seconds * fps)`; unreadable video is dropped, the audio
/// stays), audio aligned to the video length, `wall_ms` from the sound in audio mode.
pub fn rebuild_manifest(dir: &Path, mut m: Manifest, video_seconds: impl Fn(&Path) -> Option<f64>) -> Manifest {
    let fps = m.fps.filter(|f| *f > 0).unwrap_or(preset(m.quality).fps);
    let encoder = m.segments.iter().rev().find_map(|s| s.encoder);
    for index in orphan_indexes(dir, &m) {
        tracing::warn!("segment {index} is on disk but not in the manifest, recovering it");
        m.segments.push(SegmentRecord {
            index,
            video_file: None,
            encoder,
            video_frames: 0,
            wall_ms: 0,
            audio: Vec::new(),
            closed: false,
        });
    }
    m.segments.sort_by_key(|s| s.index);
    let mode = m.mode;
    let reopened: HashSet<u32> = m.segments.iter().filter(|s| !s.closed).map(|s| s.index).collect();
    for s in m.segments.iter_mut().filter(|s| !s.closed) {
        close_from_disk(dir, mode, fps, s, &video_seconds);
    }
    // a recovered segment with nothing on disk is noise
    m.segments
        .retain(|s| !reopened.contains(&s.index) || s.video_file.is_some() || !s.audio.is_empty());
    if mode == Mode::Video && m.fps.is_none() {
        m.fps = Some(fps);
    }
    m
}

fn close_from_disk(dir: &Path, mode: Mode, fps: u32, s: &mut SegmentRecord, video_seconds: &dyn Fn(&Path) -> Option<f64>) {
    let video = s.video_file.clone().or_else(|| {
        let f = segment_file(s.index, "mp4");
        dir.join(&f).is_file().then_some(f)
    });
    s.video_file = None;
    s.video_frames = 0;
    if mode == Mode::Video {
        if let Some(f) = video {
            match video_seconds(&dir.join(&f)) {
                Some(secs) if secs > 0.0 => {
                    s.video_frames = (secs * f64::from(fps)).floor() as u64;
                    if s.video_frames > 0 {
                        s.video_file = Some(f);
                    }
                }
                _ => tracing::warn!("segment {}: video is unreadable, keeping only the audio", s.index),
            }
        }
    }

    let mut files: Vec<(AudioSource, String)> = s.audio.iter().map(|a| (a.source, a.file.clone())).collect();
    for src in SOURCES {
        let f = segment_file(s.index, &format!("{}.wav", src.name()));
        if !files.iter().any(|(x, _)| *x == src) && dir.join(&f).is_file() {
            files.push((src, f));
        }
    }
    let mut tracks: Vec<(AudioSource, String, WavLayout, u64)> = Vec::new();
    for (src, file) in files {
        match repair(&dir.join(&file)) {
            Ok(Some((l, frames))) if l.sample_rate > 0 => tracks.push((src, file, l, frames)),
            Ok(_) => tracing::warn!("segment {}: {file} has no usable header, dropped", s.index),
            Err(e) => tracing::warn!("segment {}: {file} could not be repaired, dropped: {e:#}", s.index),
        }
    }

    let target_ms = if s.video_frames > 0 {
        s.video_frames * 1000 / u64::from(fps)
    } else {
        tracks
            .iter()
            .map(|(_, _, l, frames)| frames * 1000 / u64::from(l.sample_rate))
            .max()
            .unwrap_or(0)
    };
    s.wall_ms = target_ms;
    s.audio = tracks
        .into_iter()
        .map(|(source, file, l, captured)| {
            let mut frames = captured;
            let pad = align_audio(target_ms, l.sample_rate, frames).pad_frames;
            if pad > 0 {
                match pad_wav(&dir.join(&file), &l, frames, pad) {
                    Ok(()) => frames += pad,
                    Err(e) => tracing::warn!("segment {}: padding {file} failed: {e:#}", s.index),
                }
            }
            AudioTrackRecord {
                source,
                file,
                sample_rate: l.sample_rate,
                channels: l.channels,
                frames,
                outpoint_secs: align_audio(target_ms, l.sample_rate, frames).outpoint_secs,
                captured_frames: captured,
                target_ms,
            }
        })
        .collect();
    s.closed = true;
}

fn final_path(dir: &Path, finalizing_to: &str) -> PathBuf {
    let p = PathBuf::from(finalizing_to);
    match dir.parent() {
        Some(parent) if p.is_relative() => parent.join(p),
        _ => p,
    }
}

fn is_saved(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|md| md.is_file() && md.len() > 0)
}

/// Review Focus 3: a crash after the final rename must not produce a second copy.
pub fn recovery_action(dir: &Path, m: &Manifest) -> RecoveryAction {
    if let Some(to) = m.finalizing_to.as_deref() {
        let path = final_path(dir, to);
        if is_saved(&path) {
            return RecoveryAction::AlreadyFinished(path);
        }
    }
    RecoveryAction::Finalize(m.clone())
}

/// Reads the manifest and decides; for `Finalize` the open segments are closed
/// from the disk and the rebuilt manifest is saved before it is returned.
pub fn prepare_recovery(dir: &Path, video_seconds: impl Fn(&Path) -> Option<f64>) -> Result<RecoveryAction> {
    let m = read_manifest(dir)?;
    match recovery_action(dir, &m) {
        RecoveryAction::Finalize(m) => {
            let m = rebuild_manifest(dir, m, video_seconds);
            write_manifest_atomic(dir, &m)?;
            Ok(RecoveryAction::Finalize(m))
        }
        done => Ok(done),
    }
}

/// Removes a session folder, but only once the final file is in place: after a
/// failed mux the segments must survive for the next attempt.
pub fn remove_working_dir(dir: &Path, final_file: &Path) -> Result<()> {
    let is_session = dir
        .file_name()
        .is_some_and(|n| n.to_string_lossy().starts_with(SESSION_PREFIX));
    if !is_session {
        bail!("{} is not a recording session folder", dir.display());
    }
    if !is_saved(final_file) {
        bail!("{} is missing, keeping {}", final_file.display(), dir.display());
    }
    std::fs::remove_dir_all(dir).with_context(|| format!("remove {}", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::super::encoder::VideoEncoder;
    use super::super::quality::Quality;
    use super::super::segments::finalize_plan;
    use super::*;

    fn manifest(mode: Mode, segments: Vec<SegmentRecord>) -> Manifest {
        Manifest {
            version: MANIFEST_VERSION,
            mode,
            name: "Встреча".into(),
            started_at: "2026-10-31T22:00:00+03:00".into(),
            quality: Quality::Good,
            size: Some((1920, 1080)),
            fps: Some(15),
            segments,
            finalizing_to: None,
        }
    }

    fn closed_seg(index: u32) -> SegmentRecord {
        SegmentRecord {
            index,
            video_file: Some(segment_file(index, "mp4")),
            encoder: Some(VideoEncoder::X264),
            video_frames: 150,
            wall_ms: 10_000,
            audio: vec![AudioTrackRecord {
                source: AudioSource::Mic,
                file: segment_file(index, "mic.wav"),
                sample_rate: 8_000,
                channels: 1,
                frames: 80_000,
                outpoint_secs: None,
                captured_frames: 80_000,
                target_ms: 10_000,
            }],
            closed: true,
        }
    }

    fn open_seg(index: u32) -> SegmentRecord {
        SegmentRecord {
            index,
            video_file: Some(segment_file(index, "mp4")),
            encoder: Some(VideoEncoder::X264),
            video_frames: 0,
            wall_ms: 0,
            audio: Vec::new(),
            closed: false,
        }
    }

    /// A WAV as a crash leaves it: samples on disk, header never finalized.
    fn crashed_wav(path: &Path, sample_rate: u32, frames: u64) {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let mut file = File::create(path).unwrap();
        let mut w = hound::WavWriter::new(&mut file, spec).unwrap();
        for _ in 0..frames {
            w.write_sample(0.25f32).unwrap();
        }
        std::mem::forget(w);
        drop(file);
    }

    fn wav_frames(path: &Path) -> u32 {
        hound::WavReader::open(path).unwrap().duration()
    }

    #[test]
    fn scan_finds_session_folders_with_manifests_only() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join(".tyto-rec-a");
        std::fs::create_dir(&a).unwrap();
        write_manifest_atomic(&a, &manifest(Mode::Video, vec![closed_seg(1)])).unwrap();
        std::fs::create_dir(tmp.path().join(".tyto-rec-b")).unwrap();
        std::fs::write(tmp.path().join("Встреча.mp4"), b"mp4").unwrap();

        let found = scan_unfinished(tmp.path());
        assert_eq!(found.len(), 1);
        assert_eq!(
            found[0],
            UnfinishedRecording {
                dir: a.to_string_lossy().into_owned(),
                name: "Встреча".into(),
                started_at: "2026-10-31T22:00:00+03:00".into(),
                approx_seconds: 10,
                mode: Mode::Video,
            }
        );
        let json = serde_json::to_string(&found[0]).unwrap();
        assert!(json.contains("\"startedAt\"") && json.contains("\"approxSeconds\":10"));
        assert!(scan_unfinished(&tmp.path().join("missing")).is_empty());
    }

    #[test]
    fn wav_with_unwritten_header_is_repaired() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("seg-0001.mic.wav");
        crashed_wav(&path, 48_000, 48_000);
        // half a frame of a stereo file would be cut; here a stray byte is
        let mut f = OpenOptions::new().append(true).open(&path).unwrap();
        f.write_all(&[0x7f]).unwrap();
        drop(f);
        assert_eq!(repair_wav(&path).unwrap(), 48_000);
        let mut r = hound::WavReader::open(&path).unwrap();
        assert_eq!(r.duration(), 48_000);
        assert!(r.samples::<f32>().all(|s| s.unwrap() == 0.25));
        // repairing twice changes nothing
        assert_eq!(repair_wav(&path).unwrap(), 48_000);

        std::fs::write(&path, b"RIFF").unwrap();
        assert_eq!(repair_wav(&path).unwrap(), 0);
    }

    #[test]
    fn ffmpeg_duration_is_parsed() {
        assert_eq!(
            parse_ffmpeg_duration("  Duration: 00:12:03.48, start: 0.000000, bitrate: 2100 kb/s"),
            Some(723.48)
        );
        assert_eq!(parse_ffmpeg_duration("Duration: N/A, bitrate: N/A"), None);
        assert_eq!(
            parse_ffmpeg_time("frame=  100 time=00:00:06.60 bitrate=N/A\rframe=  148 time=00:00:09.86 bitrate=N/A speed=900x\n"),
            Some(9.86)
        );
        assert_eq!(parse_ffmpeg_time("time=N/A"), None);
    }

    #[test]
    fn open_segment_is_closed_from_what_reached_the_disk() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        crashed_wav(&d.join("seg-0002.mic.wav"), 8_000, 80_000);
        std::fs::write(d.join("seg-0002.mp4"), b"fragmented mp4").unwrap();
        let m = manifest(Mode::Video, vec![closed_seg(1), open_seg(2)]);

        let r = rebuild_manifest(d, m.clone(), |p| (p.file_name().unwrap() == "seg-0002.mp4").then_some(9.9));
        assert_eq!(r.segments[0], m.segments[0]);
        let s = &r.segments[1];
        assert!(s.closed);
        assert_eq!(s.video_frames, 148);
        assert_eq!(s.wall_ms, 9_866);
        assert_eq!(s.video_file.as_deref(), Some("seg-0002.mp4"));
        assert_eq!(s.audio.len(), 1);
        let a = &s.audio[0];
        assert_eq!(
            (a.source, a.frames, a.captured_frames, a.target_ms),
            (AudioSource::Mic, 80_000, 80_000, 9_866)
        );
        assert_eq!(a.outpoint_secs, Some(9.866));
        assert_eq!(wav_frames(&d.join("seg-0002.mic.wav")), 80_000);
        assert_eq!(finalize_plan(&r).unwrap().video, vec!["seg-0001.mp4", "seg-0002.mp4"]);
    }

    #[test]
    fn unreadable_open_video_is_dropped_and_its_audio_kept() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        crashed_wav(&d.join("seg-0002.mic.wav"), 8_000, 16_000);
        std::fs::write(d.join("seg-0002.mp4"), b"").unwrap();
        let r = rebuild_manifest(d, manifest(Mode::Video, vec![closed_seg(1), open_seg(2)]), |_| None);
        let s = &r.segments[1];
        assert!(s.closed && s.video_file.is_none() && s.video_frames == 0);
        assert_eq!((s.wall_ms, s.audio[0].frames), (2_000, 16_000));
        assert!(d.join("seg-0002.mp4").exists() && d.join("seg-0002.mic.wav").exists());
    }

    #[test]
    fn segment_missing_from_the_manifest_is_found_on_disk() {
        // audio mode: the segment was opened, the crash came before the manifest knew it
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        crashed_wav(&d.join("seg-0002.mic.wav"), 1_000, 1_000);
        crashed_wav(&d.join("seg-0002.system.wav"), 1_000, 500);
        std::fs::write(d.join("seg-0003.mic.gap.wav"), b"not a segment").unwrap();
        let mut first = closed_seg(1);
        first.video_file = None;
        first.video_frames = 0;
        let m = manifest(Mode::Audio, vec![first]);
        assert_eq!(approx_ms(d, &m), 11_000);

        let r = rebuild_manifest(d, m, |_| panic!("no video in audio mode"));
        assert_eq!(r.segments.len(), 2);
        let s = &r.segments[1];
        assert_eq!((s.index, s.wall_ms, s.closed), (2, 1_000, true));
        let system = s.audio.iter().find(|a| a.source == AudioSource::System).unwrap();
        assert_eq!(
            (system.frames, system.captured_frames, system.outpoint_secs),
            (1_000, 500, None)
        );
        assert_eq!(wav_frames(&d.join("seg-0002.system.wav")), 1_000);
        assert_eq!(finalize_plan(&r).unwrap().audio.len(), 2);
    }

    #[test]
    fn crash_after_rename_does_not_duplicate_the_recording() {
        let tmp = tempfile::tempdir().unwrap();
        let rec = tmp.path().join("Записи");
        let dir = rec.join(".tyto-rec-1");
        std::fs::create_dir_all(&dir).unwrap();
        let done = rec.join("Встреча.mp4");
        let mut m = manifest(Mode::Video, vec![closed_seg(1)]);
        m.finalizing_to = Some(done.to_string_lossy().into_owned());

        assert_eq!(recovery_action(&dir, &m), RecoveryAction::Finalize(m.clone()));
        // mux failed or never finished: the working folder stays
        assert!(remove_working_dir(&dir, &done).is_err());
        assert!(dir.is_dir());

        std::fs::write(&done, b"mp4").unwrap();
        assert_eq!(recovery_action(&dir, &m), RecoveryAction::AlreadyFinished(done.clone()));
        write_manifest_atomic(&dir, &m).unwrap();
        assert_eq!(
            prepare_recovery(&dir, |_| None).unwrap(),
            RecoveryAction::AlreadyFinished(done.clone())
        );
        remove_working_dir(&dir, &done).unwrap();
        assert!(!dir.exists() && done.is_file());
        assert!(remove_working_dir(&rec, &done).is_err());
    }
}
