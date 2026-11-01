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
    /// Frames that came from the device (no padding): zero means nothing was recorded.
    #[serde(default)]
    pub captured_frames: u64,
    /// Segment length the track was aligned to.
    #[serde(default)]
    pub target_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SegmentRecord {
    pub index: u32,
    pub video_file: Option<String>,
    pub encoder: Option<VideoEncoder>,
    /// Frames written to the segment; must stay 0 until the first real frame arrives.
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
    /// Size of the muxed file, written right before it is renamed to `finalizing_to`:
    /// recovery trusts a file there only if it has exactly this size.
    #[serde(default)]
    pub final_bytes: Option<u64>,
}

/// `segment_file(1, "mp4")` → `seg-0001.mp4`, `segment_file(1, "mic.wav")` → `seg-0001.mic.wav`.
pub fn segment_file(index: u32, kind: &str) -> String {
    format!("seg-{index:04}.{kind}")
}

/// Writes `manifest.json` via a temp file and rename, so a crash never leaves half a manifest.
/// The temp name is fixed: write the manifest from one thread only.
pub fn write_manifest_atomic(dir: &Path, m: &Manifest) -> Result<()> {
    let tmp = dir.join(format!("{MANIFEST}.tmp"));
    let data = serde_json::to_vec_pretty(m).context("serialize manifest")?;
    {
        let mut f = std::fs::File::create(&tmp).with_context(|| format!("create {}", tmp.display()))?;
        f.write_all(&data).context("write manifest")?;
        f.sync_all().context("sync manifest")?;
    }
    // On Windows an antivirus or the indexer may hold manifest.json for a moment.
    let target = dir.join(MANIFEST);
    let mut attempt = 0;
    loop {
        match std::fs::rename(&tmp, &target) {
            Ok(()) => return Ok(()),
            Err(_) if attempt < 3 => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e).context("rename manifest"),
        }
    }
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

/// `\\?\C:\x` → `C:\x`, `\\?\UNC\srv\x` → `\\srv\x`: ffmpeg does not open verbatim paths.
pub(super) fn strip_verbatim(p: &str) -> String {
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        p.strip_prefix(r"\\?\").unwrap_or(p).to_string()
    }
}

/// ffmpeg concat demuxer list. Paths use `/`, `'` is written as `'\''`.
/// A set time is the segment length: `outpoint` cuts a longer file, and
/// `duration` places the next file there even if this one is shorter.
pub fn concat_list(entries: &[(PathBuf, Option<f64>)]) -> String {
    let mut s = String::new();
    for (path, secs) in entries {
        let p = strip_verbatim(&path.to_string_lossy())
            .replace('\\', "/")
            .replace('\'', "'\\''");
        s.push_str(&format!("file '{p}'\n"));
        if let Some(secs) = secs {
            s.push_str(&format!("outpoint {secs}\nduration {secs}\n"));
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

/// Segment files of one audio source and their lengths in seconds, in order.
pub type AudioEntries = Vec<(String, Option<f64>)>;

/// A silent WAV that stands in for a segment where a source has no file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SilenceFile {
    pub file: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FinalizePlan {
    /// Video segment files, in order (empty in audio mode).
    pub video: Vec<String>,
    /// Per source: segment files and their lengths, in order.
    pub audio: Vec<(AudioSource, AudioEntries)>,
    /// Channels of each `audio` source (fixed per session).
    pub channels: Vec<u16>,
    pub reencode_video: bool,
    pub ext: &'static str,
    /// Written by `write_concat_lists` before the mux.
    pub silence: Vec<SilenceFile>,
}

fn has_samples(s: &SegmentRecord) -> bool {
    s.audio.iter().any(|a| a.captured_frames > 0)
}

/// Length of a segment on the final timeline.
pub(super) fn segment_ms(m: &Manifest, s: &SegmentRecord) -> u64 {
    if let Some(t) = s.audio.iter().map(|a| a.target_ms).find(|t| *t > 0) {
        return t;
    }
    match (m.mode, m.fps) {
        (Mode::Video, Some(fps)) if fps > 0 => s.video_frames * 1000 / u64::from(fps),
        _ => s.wall_ms,
    }
}

fn has_video(s: &SegmentRecord) -> bool {
    s.video_frames > 0 && s.video_file.is_some()
}

/// Length of a segment in seconds for the concat lists: a video segment is exactly
/// `frames / fps` (no millisecond rounding that would add up over the segments).
fn segment_secs(m: &Manifest, s: &SegmentRecord) -> Option<f64> {
    if let (Mode::Video, Some(fps)) = (m.mode, m.fps.filter(|f| *f > 0)) {
        if has_video(s) {
            return Some(s.video_frames as f64 / f64::from(fps));
        }
    }
    let ms = segment_ms(m, s);
    (ms > 0).then_some(ms as f64 / 1000.0)
}

/// Video mode keeps the segments with video, plus the sound recorded after the
/// last of them (the encoders gave up: the picture stops, the sound goes on).
/// No video at all (no frame ever arrived) saves the sound alone, as `.m4a`.
pub fn finalize_plan(m: &Manifest) -> Result<FinalizePlan, FinalizeError> {
    let used: Vec<&SegmentRecord> = match m.mode {
        Mode::Video => match m.segments.iter().rposition(has_video) {
            Some(last) => m
                .segments
                .iter()
                .enumerate()
                .filter(|(i, s)| has_video(s) || (*i > last && has_samples(s)))
                .map(|(_, s)| s)
                .collect(),
            None => m.segments.iter().filter(|s| has_samples(s)).collect(),
        },
        Mode::Audio => m.segments.iter().filter(|s| has_samples(s)).collect(),
    };
    if used.is_empty() {
        return Err(FinalizeError::Empty);
    }

    let is_video = m.mode == Mode::Video && used.iter().any(|s| has_video(s));
    let with_video: Vec<&&SegmentRecord> = used.iter().filter(|s| is_video && has_video(s)).collect();
    let video: Vec<String> = with_video.iter().filter_map(|s| s.video_file.clone()).collect();
    let reencode_video = with_video.windows(2).any(|w| w[0].encoder != w[1].encoder);

    let mut sources: Vec<AudioSource> = Vec::new();
    for a in used.iter().flat_map(|s| s.audio.iter()) {
        if !sources.contains(&a.source) {
            sources.push(a.source);
        }
    }
    // Every source covers every used segment, so the concat lists share one
    // timeline: a segment without a file for a source gets a silent stand-in.
    let mut audio = Vec::new();
    let mut channels = Vec::new();
    let mut silence = Vec::new();
    for src in sources {
        let Some(like) = used.iter().flat_map(|s| s.audio.iter()).find(|a| a.source == src) else {
            continue;
        };
        let mut entries: AudioEntries = Vec::new();
        for s in &used {
            let ms = segment_ms(m, s);
            let secs = segment_secs(m, s);
            match s.audio.iter().find(|a| a.source == src) {
                Some(a) => entries.push((a.file.clone(), if a.target_ms > 0 { secs } else { a.outpoint_secs })),
                None => {
                    tracing::warn!("segment {} has no {} audio, filled with silence", s.index, src.name());
                    let file = segment_file(s.index, &format!("{}.gap.wav", src.name()));
                    silence.push(SilenceFile {
                        file: file.clone(),
                        sample_rate: like.sample_rate,
                        channels: like.channels,
                        frames: (u128::from(ms) * u128::from(like.sample_rate) / 1000) as u64,
                    });
                    entries.push((file, secs));
                }
            }
        }
        audio.push((src, entries));
        channels.push(like.channels);
    }

    Ok(FinalizePlan {
        video,
        audio,
        channels,
        reencode_video,
        ext: if is_video { "mp4" } else { "m4a" },
        silence,
    })
}

pub const VIDEO_LIST: &str = "video.txt";

pub fn audio_list(source: AudioSource) -> String {
    format!("{}.txt", source.name())
}

fn write_silence_wav(path: &Path, s: &SilenceFile) -> Result<()> {
    let spec = hound::WavSpec {
        channels: s.channels.max(1),
        sample_rate: s.sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut w = hound::WavWriter::create(path, spec).with_context(|| format!("create {}", path.display()))?;
    for _ in 0..s.frames * u64::from(spec.channels) {
        w.write_sample(0.0f32)?;
    }
    w.finalize().context("finalize silence")?;
    Ok(())
}

/// Writes the silent stand-ins and the `video.txt` / `<source>.txt` concat lists
/// into the session folder.
pub fn write_concat_lists(plan: &FinalizePlan, dir: &Path) -> Result<()> {
    for s in &plan.silence {
        write_silence_wav(&dir.join(&s.file), s)?;
    }
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

/// Each input is put on its own timeline: gaps (a short segment file) become
/// silence, so the sources stay in sync with each other and with the video.
const ALIGN_FILTER: &str = "aresample=async=1:first_pts=0";

/// ffmpeg arguments for the final file: concat of the segments and ONE mixed AAC
/// track (WebView2 and WKWebView play only the first audio track, and the engine
/// mixes all tracks itself, so a second copy of the sound would double the volume).
///
/// Re-encoding (segments from different encoders) feeds every segment as its own
/// input into the `concat` filter: the concat demuxer would decode all of them
/// with the first file's SPS/PPS.
pub fn finalize_args(plan: &FinalizePlan, dir: &Path, out: &Path, enc: VideoEncoder, p: &Preset) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let s = |v: &str| v.to_string();
    let path = |name: &str| strip_verbatim(&dir.join(name).to_string_lossy());
    a.extend(["-hide_banner", "-loglevel", "error", "-y"].map(s));
    let has_video = !plan.video.is_empty();
    let reencode = has_video && plan.reencode_video;
    let concat_input = |a: &mut Vec<String>, list: &str| {
        a.extend(["-f", "concat", "-safe", "0", "-i"].map(s));
        a.push(path(list));
    };
    let video_inputs = if reencode {
        for f in &plan.video {
            a.push(s("-i"));
            a.push(path(f));
        }
        plan.video.len()
    } else if has_video {
        concat_input(&mut a, VIDEO_LIST);
        1
    } else {
        0
    };
    for (src, _) in &plan.audio {
        concat_input(&mut a, &audio_list(*src));
    }

    let mut graph: Vec<String> = Vec::new();
    let mut maps: Vec<String> = Vec::new();
    let mut video_codec: Vec<String> = Vec::new();
    if reencode {
        // `-vf` cannot apply to a filtergraph output: move it into the graph.
        let mut codec = codec_args(enc, p);
        let mut vf = String::new();
        if let Some(i) = codec.iter().position(|x| x == "-vf") {
            codec.remove(i);
            if i < codec.len() {
                vf = format!(",{}", codec.remove(i));
            }
        }
        let ins: String = (0..video_inputs).map(|i| format!("[{i}:v]")).collect();
        graph.push(format!("{ins}concat=n={video_inputs}:v=1:a=0{vf}[v]"));
        maps.push(s("[v]"));
        video_codec = codec;
    } else if has_video {
        maps.push(s("0:v"));
        video_codec.extend(["-c:v", "copy"].map(s));
    }

    let n = plan.audio.len();
    // A mono f32 WAV from hound is "1 channels (FL)", which the AAC encoder refuses:
    // relabel it as mono. Other layouts go to mono/stereo (a mix: stereo).
    let align = |k: usize, layouts: &str| {
        let mono = if plan.channels.get(k) == Some(&1) {
            ",channelmap=channel_layout=mono"
        } else {
            ""
        };
        format!("{ALIGN_FILTER}{mono},aformat=channel_layouts={layouts}")
    };
    match n {
        0 => {}
        1 => graph.push(format!("[{video_inputs}:a]{}[a]", align(0, "mono|stereo"))),
        n => {
            let mut mix = String::new();
            for k in 0..n {
                graph.push(format!("[{}:a]{}[a{k}]", video_inputs + k, align(k, "stereo")));
                mix.push_str(&format!("[a{k}]"));
            }
            // Same mix as `ffmpeg::merge_wav_files`: sum without averaging, cap the peaks.
            graph.push(format!(
                "{mix}amix=inputs={n}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.97[a]"
            ));
        }
    }
    if n > 0 {
        maps.push(s("[a]"));
    }

    if !graph.is_empty() {
        a.push(s("-filter_complex"));
        a.push(graph.join(";"));
    }
    for m in maps {
        a.push(s("-map"));
        a.push(m);
    }
    a.extend(video_codec);
    if n > 0 {
        a.extend(["-c:a", "aac", "-b:a", "128k"].map(s));
    } else {
        a.push(s("-an"));
    }
    a.extend(["-movflags", "+faststart"].map(s));
    a.push(out.to_string_lossy().into_owned());
    a
}

/// Free name for the final file in `Записи/`: `name.mp4`, `name (1).mp4`, ...
/// The recorder uses `pick_output_path`, which also skips names other sessions reserved.
#[cfg(test)]
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
            captured_frames: frames,
            target_ms: frames * 1000 / 48_000,
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
            final_bytes: None,
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
    fn concat_list_fixes_segment_length_and_strips_verbatim_prefix() {
        let list = concat_list(&[
            (PathBuf::from(r"\\?\C:\Записи\.tyto-rec-1\seg-0001.mic.wav"), Some(600.0)),
            (PathBuf::from(r"\\?\UNC\nas\share\seg-0002.mic.wav"), None),
        ]);
        assert_eq!(
            list,
            "file 'C:/Записи/.tyto-rec-1/seg-0001.mic.wav'\noutpoint 600\nduration 600\nfile '//nas/share/seg-0002.mic.wav'\n"
        );
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
        assert_eq!(plan.audio[0].1, vec![("seg-0002.mic.wav".to_string(), Some(10.0))]);
        audio_only.segments = vec![seg(1, 0, &[0])];
        assert_eq!(finalize_plan(&audio_only).unwrap_err(), FinalizeError::Empty);
    }

    #[test]
    fn sound_after_the_video_gave_up_is_kept_and_no_video_saves_the_sound() {
        let mut tail = seg(3, 0, &[96_000]);
        tail.video_file = None;
        tail.encoder = None;
        let m = manifest_with(vec![seg(1, 0, &[48_000]), seg(2, 150, &[480_000]), tail]);
        let plan = finalize_plan(&m).unwrap();
        assert_eq!((plan.ext, plan.video.clone()), ("mp4", vec!["seg-0002.mp4".to_string()]));
        // segment 1 (before the first frame) is dropped, 3 (after the last) is kept
        assert_eq!(
            plan.audio[0].1,
            vec![
                ("seg-0002.mic.wav".to_string(), Some(10.0)),
                ("seg-0003.mic.wav".to_string(), Some(2.0))
            ]
        );

        let never = manifest_with(vec![seg(1, 0, &[48_000]), seg(2, 0, &[96_000])]);
        let plan = finalize_plan(&never).unwrap();
        assert_eq!(plan.ext, "m4a");
        assert!(plan.video.is_empty());
        assert_eq!(plan.audio[0].1.len(), 2);
    }

    #[test]
    fn one_source_keeps_mono_or_stereo_for_aac() {
        let mono = finalize_plan(&manifest_with(vec![seg(1, 150, &[480_000])])).unwrap();
        assert_eq!(mono.channels, vec![1]);
        let args = finalize_args(
            &mono,
            Path::new("/s"),
            Path::new("/o.mp4"),
            VideoEncoder::X264,
            &preset(Quality::Good),
        );
        assert!(args.join(" ").contains(
            "[1:a]aresample=async=1:first_pts=0,channelmap=channel_layout=mono,aformat=channel_layouts=mono|stereo[a]"
        ));
        let mut s = seg(1, 150, &[480_000]);
        s.audio[0].channels = 2;
        let stereo = finalize_plan(&manifest_with(vec![s])).unwrap();
        let args = finalize_args(
            &stereo,
            Path::new("/s"),
            Path::new("/o.mp4"),
            VideoEncoder::X264,
            &preset(Quality::Good),
        );
        assert!(args
            .join(" ")
            .contains("[1:a]aresample=async=1:first_pts=0,aformat=channel_layouts=mono|stereo[a]"));
    }

    #[test]
    fn video_segments_last_exactly_frames_over_fps() {
        // 7 frames at 15 fps = 0.4666… s; the audio target is 466 ms. Over 1000
        // segments millisecond rounding alone would drift by 0.67 s.
        let mut s = seg(1, 7, &[22_368]);
        s.audio[0].target_ms = 466;
        let plan = finalize_plan(&manifest_with(vec![s])).unwrap();
        let secs = plan.audio[0].1[0].1.unwrap();
        assert!((secs - 7.0 / 15.0).abs() < 1e-9, "{secs}");
    }

    #[test]
    fn padding_alone_is_not_a_recording() {
        // Stop 0.3 s after start in audio mode: the sink padded 0.3 s of silence, nothing was captured.
        let mut padded = seg(1, 0, &[14_400, 14_400]);
        for t in &mut padded.audio {
            t.captured_frames = 0;
        }
        let mut m = manifest_with(vec![padded]);
        m.mode = Mode::Audio;
        assert_eq!(finalize_plan(&m).unwrap_err(), FinalizeError::Empty);
    }

    #[test]
    fn a_source_missing_in_one_segment_gets_silence_not_dropped() {
        let m = manifest_with(vec![seg(1, 150, &[480_000, 480_000]), seg(2, 150, &[480_000])]);
        let plan = finalize_plan(&m).unwrap();
        assert_eq!(plan.audio.len(), 2);
        let system = &plan.audio[1].1;
        assert_eq!(system[1], ("seg-0002.system.gap.wav".to_string(), Some(10.0)));
        assert_eq!(plan.silence[0].frames, 480_000);

        let dir = tempfile::tempdir().unwrap();
        let mut small = plan.clone();
        small.silence[0].frames = 10;
        write_concat_lists(&small, dir.path()).unwrap();
        let r = hound::WavReader::open(dir.path().join("seg-0002.system.gap.wav")).unwrap();
        assert_eq!((r.duration(), r.spec().sample_rate), (10, 48_000));
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
        );
        let joined = args.join(" ");
        assert!(joined.contains("-c:v h264_mf") && !joined.contains("-c:v copy"));
        // each segment is its own input, joined by the concat filter (not the demuxer)
        assert_eq!(joined.matches("-f concat").count(), 1);
        assert!(!joined.contains("video.txt") && !joined.contains("-vf"));
        let graph = &args[args.iter().position(|x| x == "-filter_complex").unwrap() + 1];
        assert!(graph.starts_with("[0:v][1:v]concat=n=2:v=1:a=0,format=nv12[v];[2:a]aresample"));
        assert!(joined.contains("-map [v]") && joined.contains("-map [a]"));
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
        assert!(args.contains("amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.97[a]"));
        // mono sources are relabeled (AAC refuses hound's "1 channels (FL)") and mixed in stereo
        let input = "aresample=async=1:first_pts=0,channelmap=channel_layout=mono,aformat=channel_layouts=stereo";
        assert!(
            args.contains(&format!("[1:a]{input}[a0];[2:a]{input}[a1];[a0][a1]amix")),
            "{args}"
        );
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
        assert_eq!(mic.matches("duration 10\n").count(), 2);
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
