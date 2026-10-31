use std::fmt;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use eyre::{Context, Result};
use serde::{Deserialize, Serialize};

use super::encoder::{codec_args, VideoEncoder};
use super::quality::{Preset, Quality};
use super::session::Mode;

/// Working folder of a recording session: `<Записи>/.tyto-rec-<id>/`.
pub const SESSION_PREFIX: &str = ".tyto-rec-";
pub const MANIFEST: &str = "manifest.json";
pub const MANIFEST_VERSION: u32 = 1;
/// A segment is closed at least this often, so a f32 WAV stays below 4 GB.
pub const SEGMENT_MAX: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioSource {
    Mic,
    System,
}

impl AudioSource {
    pub fn name(self) -> &'static str {
        match self {
            AudioSource::Mic => "mic",
            AudioSource::System => "system",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AudioTrackRecord {
    pub source: AudioSource,
    /// File name inside the session folder.
    pub file: String,
    pub sample_rate: u32,
    pub channels: u16,
    /// Frames in the file (silence padding included).
    pub frames: u64,
    /// Set when the file is longer than the segment: concat cuts it here.
    pub outpoint_secs: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SegmentRecord {
    pub index: u32,
    pub video_file: Option<String>,
    pub encoder: Option<VideoEncoder>,
    pub video_frames: u64,
    /// Active (unpaused) time of the segment.
    pub wall_ms: u64,
    pub audio: Vec<AudioTrackRecord>,
    pub closed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub mode: Mode,
    pub name: String,
    pub started_at: String,
    pub quality: Quality,
    pub size: Option<(u32, u32)>,
    pub fps: Option<u32>,
    pub segments: Vec<SegmentRecord>,
    /// Final file being written; set before the mux starts (used by recovery).
    pub finalizing_to: Option<String>,
}

/// `segment_file(1, "mp4")` → `seg-0001.mp4`, `segment_file(1, "mic.wav")` → `seg-0001.mic.wav`.
pub fn segment_file(index: u32, kind: &str) -> String {
    format!("seg-{index:04}.{kind}")
}

/// Writes `manifest.json` via a temp file and rename, so a crash never leaves half a manifest.
pub fn write_manifest_atomic(dir: &Path, m: &Manifest) -> Result<()> {
    let tmp = dir.join(format!("{MANIFEST}.tmp"));
    let data = serde_json::to_vec_pretty(m).context("serialize manifest")?;
    {
        let mut f = std::fs::File::create(&tmp).with_context(|| format!("create {}", tmp.display()))?;
        f.write_all(&data).context("write manifest")?;
        f.sync_all().context("sync manifest")?;
    }
    std::fs::rename(&tmp, dir.join(MANIFEST)).context("rename manifest")?;
    Ok(())
}

pub fn read_manifest(dir: &Path) -> Result<Manifest> {
    let path = dir.join(MANIFEST);
    let data = std::fs::read(&path).with_context(|| format!("read {}", path.display()))?;
    serde_json::from_slice(&data).context("parse manifest")
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AudioAlign {
    pub pad_frames: u64,
    pub outpoint_secs: Option<f64>,
}

/// Fits `frames` of audio to `target_ms`: short audio is padded with silence,
/// long audio is cut by `outpoint` in the concat list.
pub fn align_audio(target_ms: u64, sample_rate: u32, frames: u64) -> AudioAlign {
    let target = (u128::from(target_ms) * u128::from(sample_rate) / 1000) as u64;
    if frames < target {
        AudioAlign {
            pad_frames: target - frames,
            outpoint_secs: None,
        }
    } else if frames > target {
        AudioAlign {
            pad_frames: 0,
            outpoint_secs: Some(target_ms as f64 / 1000.0),
        }
    } else {
        AudioAlign {
            pad_frames: 0,
            outpoint_secs: None,
        }
    }
}

/// ffmpeg concat demuxer list. Paths use `/`, `'` is written as `'\''`.
pub fn concat_list(entries: &[(PathBuf, Option<f64>)]) -> String {
    let mut s = String::new();
    for (path, outpoint) in entries {
        let p = path.to_string_lossy().replace('\\', "/").replace('\'', "'\\''");
        s.push_str(&format!("file '{p}'\n"));
        if let Some(secs) = outpoint {
            s.push_str(&format!("outpoint {secs}\n"));
        }
    }
    s
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FinalizeError {
    /// Zero frames and zero samples: nothing to save.
    Empty,
}

impl fmt::Display for FinalizeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FinalizeError::Empty => f.write_str("recording is too short, nothing to save"),
        }
    }
}

impl std::error::Error for FinalizeError {}

/// Segment files of one audio source and their outpoints, in order.
pub type AudioEntries = Vec<(String, Option<f64>)>;

#[derive(Clone, Debug, PartialEq)]
pub struct FinalizePlan {
    /// Video segment files, in order (empty in audio mode).
    pub video: Vec<String>,
    /// Per source: segment files and their outpoints, in order.
    pub audio: Vec<(AudioSource, AudioEntries)>,
    pub reencode_video: bool,
    pub ext: &'static str,
}

fn has_samples(s: &SegmentRecord) -> bool {
    s.audio.iter().any(|a| a.frames > 0)
}

pub fn finalize_plan(m: &Manifest) -> Result<FinalizePlan, FinalizeError> {
    let used: Vec<&SegmentRecord> = match m.mode {
        Mode::Video => m
            .segments
            .iter()
            .filter(|s| s.video_frames > 0 && s.video_file.is_some())
            .collect(),
        Mode::Audio => m.segments.iter().filter(|s| has_samples(s)).collect(),
    };
    if used.is_empty() {
        return Err(FinalizeError::Empty);
    }

    let video: Vec<String> = used.iter().filter_map(|s| s.video_file.clone()).collect();
    let reencode_video = used.windows(2).any(|w| w[0].encoder != w[1].encoder);

    // A source goes into the mix only if every used segment has it: concat lists
    // of different sources must cover the same timeline, or the sources drift apart.
    let mut sources: Vec<AudioSource> = Vec::new();
    for a in used.iter().flat_map(|s| s.audio.iter()) {
        if !sources.contains(&a.source) {
            sources.push(a.source);
        }
    }
    let mut audio = Vec::new();
    for src in sources {
        let entries: Vec<(String, Option<f64>)> = used
            .iter()
            .filter_map(|s| s.audio.iter().find(|a| a.source == src))
            .map(|a| (a.file.clone(), a.outpoint_secs))
            .collect();
        if entries.len() == used.len() {
            audio.push((src, entries));
        } else {
            tracing::warn!("audio source {} is missing in some segments, left out of the mix", src.name());
        }
    }
    if m.mode == Mode::Audio && audio.is_empty() {
        return Err(FinalizeError::Empty);
    }

    Ok(FinalizePlan {
        video,
        audio,
        reencode_video,
        ext: match m.mode {
            Mode::Video => "mp4",
            Mode::Audio => "m4a",
        },
    })
}

pub const VIDEO_LIST: &str = "video.txt";

pub fn audio_list(source: AudioSource) -> String {
    format!("{}.txt", source.name())
}

/// Writes `video.txt` and `<source>.txt` concat lists into the session folder.
pub fn write_concat_lists(plan: &FinalizePlan, dir: &Path) -> Result<()> {
    if !plan.video.is_empty() {
        let entries: Vec<(PathBuf, Option<f64>)> = plan.video.iter().map(|f| (dir.join(f), None)).collect();
        std::fs::write(dir.join(VIDEO_LIST), concat_list(&entries)).context("write video list")?;
    }
    for (src, files) in &plan.audio {
        let entries: Vec<(PathBuf, Option<f64>)> = files.iter().map(|(f, o)| (dir.join(f), *o)).collect();
        std::fs::write(dir.join(audio_list(*src)), concat_list(&entries)).context("write audio list")?;
    }
    Ok(())
}

/// ffmpeg arguments for the final file: concat of the segments and ONE mixed AAC
/// track (WebView2 and WKWebView play only the first audio track, and the engine
/// mixes all tracks itself, so a second copy of the sound would double the volume).
pub fn finalize_args(plan: &FinalizePlan, dir: &Path, out: &Path, enc: VideoEncoder, p: &Preset) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let s = |v: &str| v.to_string();
    a.extend(["-hide_banner", "-loglevel", "error", "-y"].map(s));
    let has_video = !plan.video.is_empty();
    let concat_input = |a: &mut Vec<String>, list: String| {
        a.extend(["-f", "concat", "-safe", "0", "-i"].map(s));
        a.push(dir.join(list).to_string_lossy().into_owned());
    };
    if has_video {
        concat_input(&mut a, VIDEO_LIST.to_string());
    }
    for (src, _) in &plan.audio {
        concat_input(&mut a, audio_list(*src));
    }

    if has_video {
        a.extend(["-map", "0:v"].map(s));
        if plan.reencode_video {
            a.extend(codec_args(enc, p));
        } else {
            a.extend(["-c:v", "copy"].map(s));
        }
    }
    let first_audio = usize::from(has_video);
    match plan.audio.len() {
        0 => a.push(s("-an")),
        1 => {
            a.push(s("-map"));
            a.push(format!("{first_audio}:a"));
        }
        n => {
            let inputs: String = (first_audio..first_audio + n).map(|i| format!("[{i}:a]")).collect();
            // Same mix as `ffmpeg::merge_wav_files`: sum without averaging, cap the peaks.
            a.push(s("-filter_complex"));
            a.push(format!(
                "{inputs}amix=inputs={n}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.97[a]"
            ));
            a.extend(["-map", "[a]"].map(s));
        }
    }
    if !plan.audio.is_empty() {
        a.extend(["-c:a", "aac", "-b:a", "128k"].map(s));
    }
    a.extend(["-movflags", "+faststart"].map(s));
    a.push(out.to_string_lossy().into_owned());
    a
}

/// Free name for the final file in `Записи/`: `name.mp4`, `name (1).mp4`, ...
pub fn final_output_path(recordings_dir: &Path, stem: &str, ext: &str) -> PathBuf {
    crate::cmd::files::available_path(recordings_dir, stem, ext)
}

#[cfg(test)]
mod tests {
    use super::super::quality::preset;
    use super::*;

    fn track(source: AudioSource, index: u32, frames: u64) -> AudioTrackRecord {
        AudioTrackRecord {
            source,
            file: segment_file(index, &format!("{}.wav", source.name())),
            sample_rate: 48_000,
            channels: 1,
            frames,
            outpoint_secs: None,
        }
    }

    fn seg(index: u32, frames: u64, audio: &[u64]) -> SegmentRecord {
        let sources = [AudioSource::Mic, AudioSource::System];
        SegmentRecord {
            index,
            video_file: Some(segment_file(index, "mp4")),
            encoder: Some(VideoEncoder::X264),
            video_frames: frames,
            wall_ms: frames * 1000 / 15,
            audio: audio.iter().zip(sources).map(|(f, src)| track(src, index, *f)).collect(),
            closed: true,
        }
    }

    fn manifest_with(segments: Vec<SegmentRecord>) -> Manifest {
        Manifest {
            version: MANIFEST_VERSION,
            mode: Mode::Video,
            name: "Запись 31.10.2026".into(),
            started_at: "2026-10-31T22:00:00+03:00".into(),
            quality: Quality::Good,
            size: Some((1920, 1080)),
            fps: Some(15),
            segments,
            finalizing_to: None,
        }
    }

    fn two_source_plan() -> FinalizePlan {
        finalize_plan(&manifest_with(vec![
            seg(1, 150, &[480_000, 480_000]),
            seg(2, 150, &[480_000, 480_000]),
        ]))
        .unwrap()
    }

    #[test]
    fn audio_is_padded_or_trimmed_to_the_video_length() {
        assert_eq!(
            align_audio(10_000, 48_000, 470_400),
            AudioAlign {
                pad_frames: 9_600,
                outpoint_secs: None
            }
        );
        assert_eq!(
            align_audio(10_000, 48_000, 484_800),
            AudioAlign {
                pad_frames: 0,
                outpoint_secs: Some(10.0)
            }
        );
    }

    #[test]
    fn concat_list_escapes_apostrophes_and_keeps_cyrillic() {
        let list = concat_list(&[
            (
                PathBuf::from("C:\\Users\\Д\\Documents\\Tyto\\Записи\\.tyto-rec-1\\seg-0001.mic.wav"),
                Some(12.5),
            ),
            (PathBuf::from("/Users/d/Tyto/Записи/O'Neil/seg-0002.mic.wav"), None),
        ]);
        assert!(list.contains("file 'C:/Users/Д/Documents/Tyto/Записи/.tyto-rec-1/seg-0001.mic.wav'\noutpoint 12.5\n"));
        assert!(list.contains("file '/Users/d/Tyto/Записи/O'\\''Neil/seg-0002.mic.wav'\n"));
    }

    #[test]
    fn empty_segments_are_skipped_and_all_empty_is_an_error() {
        // Review Focus 1: stop a second after start, pause right after start
        let m = manifest_with(vec![seg(1, 0, &[0, 0]), seg(2, 0, &[0])]);
        assert_eq!(finalize_plan(&m).unwrap_err(), FinalizeError::Empty);
        let m = manifest_with(vec![seg(1, 0, &[0]), seg(2, 150, &[480_000])]);
        assert_eq!(finalize_plan(&m).unwrap().video, vec!["seg-0002.mp4"]);

        let mut audio_only = manifest_with(vec![seg(1, 0, &[0, 0]), seg(2, 0, &[480_000, 0])]);
        audio_only.mode = Mode::Audio;
        let plan = finalize_plan(&audio_only).unwrap();
        assert_eq!(plan.ext, "m4a");
        assert!(plan.video.is_empty());
        assert_eq!(plan.audio[0].1, vec![("seg-0002.mic.wav".to_string(), None)]);
        audio_only.segments = vec![seg(1, 0, &[0])];
        assert_eq!(finalize_plan(&audio_only).unwrap_err(), FinalizeError::Empty);
    }

    #[test]
    fn mixed_encoders_force_a_video_reencode() {
        let mut second = seg(2, 150, &[480_000]);
        second.encoder = Some(VideoEncoder::MediaFoundation);
        let plan = finalize_plan(&manifest_with(vec![seg(1, 150, &[480_000]), second])).unwrap();
        assert!(plan.reencode_video);
        assert!(!two_source_plan().reencode_video);
        let args = finalize_args(
            &plan,
            Path::new("/s"),
            Path::new("/out.mp4"),
            VideoEncoder::MediaFoundation,
            &preset(Quality::Good),
        )
        .join(" ");
        assert!(args.contains("-c:v h264_mf") && !args.contains("-c:v copy"));
    }

    #[test]
    fn finalize_mixes_two_sources_into_one_aac_track() {
        let args = finalize_args(
            &two_source_plan(),
            Path::new("/s"),
            Path::new("/out.mp4"),
            VideoEncoder::X264,
            &preset(Quality::Good),
        )
        .join(" ");
        assert!(args.contains("[1:a][2:a]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.97[a]"));
        assert!(
            args.contains("-map 0:v") && args.contains("-c:v copy") && args.contains("-c:a aac") && args.contains("+faststart")
        );
        assert_eq!(args.matches("-map").count(), 2);
        assert_eq!(args.matches("-f concat -safe 0 -i").count(), 3);
        assert!(args.ends_with("/out.mp4"));
    }

    #[test]
    fn manifest_roundtrips_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let mut m = manifest_with(vec![seg(1, 150, &[480_000, 470_000])]);
        m.segments[0].audio[0].outpoint_secs = Some(10.0);
        write_manifest_atomic(dir.path(), &m).unwrap();
        // a second write replaces the first one
        m.finalizing_to = Some("Запись.mp4".into());
        write_manifest_atomic(dir.path(), &m).unwrap();
        assert_eq!(read_manifest(dir.path()).unwrap(), m);
        assert!(!dir.path().join(format!("{MANIFEST}.tmp")).exists());
        let json = std::fs::read_to_string(dir.path().join(MANIFEST)).unwrap();
        assert!(json.contains("\"mode\": \"video\"") && json.contains("\"source\": \"mic\""));
    }

    #[test]
    fn concat_lists_are_written_next_to_the_segments() {
        let dir = tempfile::tempdir().unwrap();
        write_concat_lists(&two_source_plan(), dir.path()).unwrap();
        let mic = std::fs::read_to_string(dir.path().join("mic.txt")).unwrap();
        assert_eq!(mic.matches("file '").count(), 2);
        assert!(dir.path().join(VIDEO_LIST).is_file() && dir.path().join("system.txt").is_file());
    }

    #[test]
    fn final_output_path_does_not_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(final_output_path(dir.path(), "Запись", "mp4"), dir.path().join("Запись.mp4"));
        std::fs::write(dir.path().join("Запись.mp4"), b"x").unwrap();
        assert_eq!(
            final_output_path(dir.path(), "Запись", "mp4"),
            dir.path().join("Запись (1).mp4")
        );
    }
}
