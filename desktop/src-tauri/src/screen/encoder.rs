use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::quality::{preset, Preset, Quality};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoEncoder {
    Nvenc,
    Qsv,
    Amf,
    MediaFoundation,
    /// `h264_mf` on the software MFT: the last resort on a PC without a hardware
    /// encoder (and the one a CI runner without a GPU can run).
    MediaFoundationSoftware,
    VideoToolbox,
    X264,
}

impl VideoEncoder {
    pub fn ffmpeg_name(self) -> &'static str {
        match self {
            VideoEncoder::Nvenc => "h264_nvenc",
            VideoEncoder::Qsv => "h264_qsv",
            VideoEncoder::Amf => "h264_amf",
            VideoEncoder::MediaFoundation | VideoEncoder::MediaFoundationSoftware => "h264_mf",
            VideoEncoder::VideoToolbox => "h264_videotoolbox",
            VideoEncoder::X264 => "libx264",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TargetOs {
    Windows,
    MacOs,
}

impl TargetOs {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            TargetOs::MacOs
        } else {
            TargetOs::Windows
        }
    }
}

/// Encoder names from `ffmpeg -encoders` output (video codec rows only).
pub fn parse_encoders(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter_map(|line| {
            let mut it = line.split_whitespace();
            let flags = it.next()?;
            let name = it.next()?;
            let is_video =
                flags.len() == 6 && flags.starts_with('V') && flags[1..].chars().all(|c| c == '.' || c.is_ascii_alphabetic());
            (is_video && name != "=").then(|| name.to_string())
        })
        .collect()
}

/// Encoders to try, in preference order, limited to those present in `listed`.
pub fn candidates(listed: &[String], os: TargetOs) -> Vec<VideoEncoder> {
    let order: &[VideoEncoder] = match os {
        TargetOs::Windows => &[
            VideoEncoder::Nvenc,
            VideoEncoder::Qsv,
            VideoEncoder::Amf,
            VideoEncoder::MediaFoundation,
            VideoEncoder::X264,
        ],
        TargetOs::MacOs => &[VideoEncoder::VideoToolbox, VideoEncoder::X264],
    };
    order
        .iter()
        .copied()
        .filter(|e| listed.iter().any(|n| n == e.ffmpeg_name()))
        .collect()
}

/// Encoders a session tries in turn, one attempt each: the selected one, the
/// candidates after it, then the software Media Foundation encoder on Windows.
pub fn encoder_queue(selected: VideoEncoder, listed: &[String], os: TargetOs) -> Vec<VideoEncoder> {
    let mut queue = vec![selected];
    let rest = candidates(listed, os);
    // Those before the selected one already failed their probes.
    let after = rest.iter().position(|e| *e == selected).map_or(rest.len(), |i| i + 1);
    queue.extend(rest[after..].iter().copied().filter(|e| *e != selected));
    let mf_listed = listed.iter().any(|n| n == "h264_mf");
    if os == TargetOs::Windows && (mf_listed || selected == VideoEncoder::MediaFoundation) {
        queue.push(VideoEncoder::MediaFoundationSoftware);
    }
    queue.dedup();
    queue
}

/// Raw BGRA frames on stdin, fragmented MP4 (video only) out.
pub fn video_segment_args(enc: VideoEncoder, p: &Preset, size: (u32, u32), out: &Path) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));
    push(&["-hide_banner", "-loglevel", "error", "-y"]);
    push(&["-f", "rawvideo", "-pix_fmt", "bgra"]);
    let video_size = format!("{}x{}", size.0, size.1);
    push(&["-video_size", &video_size]);
    let fps = p.fps.to_string();
    push(&["-framerate", &fps, "-i", "pipe:0", "-an"]);
    a.extend(codec_args(enc, p));
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));
    push(&["-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4"]);
    a.push(out.to_string_lossy().into_owned());
    a
}

/// Encoder flags shared by the real pipeline and the probe, so the probe
/// exercises exactly what recording will use (hw_encoding, nv12, bitrate).
pub fn codec_args(enc: VideoEncoder, p: &Preset) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));
    push(&["-c:v", enc.ffmpeg_name()]);
    match enc {
        VideoEncoder::Nvenc => push(&["-preset", "p4", "-rc", "vbr"]),
        VideoEncoder::Qsv => push(&["-preset", "veryfast"]),
        VideoEncoder::Amf => push(&["-quality", "speed", "-rc", "vbr_peak"]),
        VideoEncoder::MediaFoundation => push(&["-hw_encoding", "1", "-rate_control", "u_vbr", "-scenario", "display_remoting"]),
        VideoEncoder::MediaFoundationSoftware => push(&["-rate_control", "u_vbr", "-scenario", "display_remoting"]),
        VideoEncoder::VideoToolbox => push(&["-realtime", "1", "-allow_sw", "1"]),
        VideoEncoder::X264 => push(&["-preset", "veryfast"]),
    }
    let bitrate = format!("{}k", p.bitrate_kbps);
    let maxrate = format!("{}k", p.maxrate_kbps);
    let bufsize = format!("{}k", p.bufsize_kbps);
    let gop = (p.fps * 2).to_string();
    push(&["-b:v", &bitrate, "-maxrate", &maxrate, "-bufsize", &bufsize, "-g", &gop]);
    if enc == VideoEncoder::X264 {
        push(&["-pix_fmt", "yuv420p"]);
    } else {
        push(&["-vf", "format=nv12"]);
    }
    a
}

/// Encodes a single synthetic frame with the same codec flags as recording.
pub fn probe_args(enc: VideoEncoder) -> Vec<String> {
    let mut a: Vec<String> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=size=256x144:rate=1",
        "-frames:v",
        "1",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    a.extend(codec_args(enc, &preset(Quality::Good)));
    a.extend(["-f", "null", "-"].iter().map(|s| s.to_string()));
    a
}

/// Search order: exe dir, `../Resources` (mac bundle), cwd, PATH.
/// The bundle wins over PATH on purpose: users get the essentials build.
pub fn ffmpeg_candidates(exe_dir: Option<&Path>, cwd: Option<&Path>, on_path: Option<PathBuf>) -> Vec<PathBuf> {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let mut v = Vec::new();
    if let Some(d) = exe_dir {
        v.push(d.join(name));
        v.push(d.join("../Resources").join(name));
    }
    if let Some(d) = cwd {
        v.push(d.join(name));
    }
    if let Some(p) = on_path {
        v.push(p);
    }
    v
}

fn find_on_path() -> Option<PathBuf> {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths).map(|d| d.join(name)).find(|p| p.is_file())
}

/// First existing ffmpeg: the bundled one, then PATH.
/// Unlike `crate::ffmpeg::find_ffmpeg_path`, the bundle is preferred over PATH:
/// a developer's full PATH build must not mask the essentials build users get.
pub fn bundled_ffmpeg() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok();
    let cwd = std::env::current_dir().ok();
    ffmpeg_candidates(exe.as_deref().and_then(|e| e.parent()), cwd.as_deref(), find_on_path())
        .into_iter()
        .find(|p| p.is_file())
}

/// Runs ffmpeg and returns (success, stdout); a run longer than `timeout` is killed and fails.
fn run(ffmpeg: &Path, args: &[String], timeout: Duration) -> Option<(bool, String)> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    // Drain stdout on a thread so a full pipe cannot stall the child.
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        s.push_str(&String::from_utf8_lossy(&buf));
        s
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let out = reader.join().unwrap_or_default();
    status.map(|st| (st.success(), out))
}

const LIST_TIMEOUT: Duration = Duration::from_secs(3);
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Video encoders of the bundle (`ffmpeg -encoders`). A non-empty list is cached
/// per process. Blocking (up to 3 s).
pub fn listed_encoders(ffmpeg: &Path) -> Vec<String> {
    static CACHE: OnceLock<Vec<String>> = OnceLock::new();
    if let Some(l) = CACHE.get() {
        return l.clone();
    }
    let listed = run(ffmpeg, &["-hide_banner".to_string(), "-encoders".to_string()], LIST_TIMEOUT)
        .map(|(_, out)| parse_encoders(&out))
        .unwrap_or_default();
    if listed.is_empty() {
        return listed;
    }
    CACHE.get_or_init(|| listed).clone()
}

/// One synthetic frame encodes with `enc` and the recording flags. Blocking (up to 5 s).
pub fn probe_ok(ffmpeg: &Path, enc: VideoEncoder) -> bool {
    matches!(run(ffmpeg, &probe_args(enc), PROBE_TIMEOUT), Some((true, _)))
}

/// Helpers for tests that run the real bundled ffmpeg.
#[cfg(test)]
pub(super) mod test_support {
    use super::*;

    /// `desktop/src-tauri/binaries/ffmpeg-<triple>` (fetched by `chore setup`), else the usual search.
    pub fn bundled_ffmpeg_for_tests() -> Option<PathBuf> {
        let triple = if cfg!(windows) {
            "x86_64-pc-windows-msvc.exe"
        } else if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        };
        let sidecar = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("ffmpeg-{triple}"));
        if sidecar.is_file() {
            Some(sidecar)
        } else {
            bundled_ffmpeg()
        }
    }

    /// An encoder a CI runner without a GPU can run.
    pub fn test_encoder() -> VideoEncoder {
        match TargetOs::current() {
            TargetOs::Windows => VideoEncoder::MediaFoundationSoftware,
            TargetOs::MacOs => VideoEncoder::VideoToolbox,
        }
    }

    /// The bundled ffmpeg, if it can encode with `test_encoder` here.
    pub fn usable_ffmpeg() -> Option<PathBuf> {
        let Some(ffmpeg) = bundled_ffmpeg_for_tests() else {
            eprintln!("no ffmpeg, skipped");
            return None;
        };
        if probe_ok(&ffmpeg, test_encoder()) {
            Some(ffmpeg)
        } else {
            eprintln!("{:?} can not encode here, skipped", test_encoder());
            None
        }
    }
}

/// Every encoder worth a probe, in preference order: the listed candidates,
/// then the software Media Foundation encoder on Windows.
pub fn probe_order(listed: &[String], os: TargetOs) -> Vec<VideoEncoder> {
    let mut order = candidates(listed, os);
    if os == TargetOs::Windows && listed.iter().any(|n| n == "h264_mf") {
        order.push(VideoEncoder::MediaFoundationSoftware);
    }
    order
}

/// The first encoder of `order` that `works`.
pub fn first_working(order: &[VideoEncoder], works: impl Fn(VideoEncoder) -> bool) -> Option<VideoEncoder> {
    order.iter().copied().find(|e| works(*e))
}

/// Picks the first encoder that is listed by the bundle and passes a probe
/// (the software MF encoder included). `None`: no encoder works here, the
/// recording can not have video. Blocking (up to ~3 s + 5 s per candidate):
/// call from `spawn_blocking`. A verified choice is cached per process; a
/// failure is not (the next call probes again).
pub fn select_encoder(ffmpeg: &Path, os: TargetOs) -> Option<VideoEncoder> {
    static CACHE: OnceLock<VideoEncoder> = OnceLock::new();
    if let Some(e) = CACHE.get() {
        return Some(*e);
    }
    let order = probe_order(&listed_encoders(ffmpeg), os);
    match first_working(&order, |e| probe_ok(ffmpeg, e)) {
        Some(e) => {
            tracing::info!("selected encoder {}", e.ffmpeg_name());
            Some(*CACHE.get_or_init(|| e))
        }
        None => {
            tracing::warn!(
                "no video encoder passed a probe (tried {:?})",
                order.iter().map(|e| e.ffmpeg_name()).collect::<Vec<_>>()
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::quality::{preset, Quality};
    use super::*;

    #[test]
    fn candidates_follow_platform_order_and_bundle_contents() {
        let listed =
            parse_encoders(" V....D libx264  libx264 H.264\n V....D h264_mf  H264 via MediaFoundation\n A....D aac  AAC\n");
        assert_eq!(listed, vec!["libx264", "h264_mf"]);
        assert_eq!(
            candidates(&listed, TargetOs::Windows),
            vec![VideoEncoder::MediaFoundation, VideoEncoder::X264]
        );
        assert_eq!(candidates(&["libx264".into()], TargetOs::MacOs), vec![VideoEncoder::X264]);
    }

    #[test]
    fn bundle_without_libx264_still_yields_platform_encoder() {
        let listed = parse_encoders(
            " V..... = Video\n ------\n V....D h264_mf  H264 via MediaFoundation\n V....D h264_videotoolbox  VT\n A....D aac  AAC\n",
        );
        assert_eq!(listed, vec!["h264_mf", "h264_videotoolbox"]);
        assert_eq!(candidates(&listed, TargetOs::Windows), vec![VideoEncoder::MediaFoundation]);
        assert_eq!(candidates(&listed, TargetOs::MacOs), vec![VideoEncoder::VideoToolbox]);
    }

    #[test]
    fn segment_args_are_raw_bgra_in_fragmented_mp4_out() {
        let args = video_segment_args(
            VideoEncoder::X264,
            &preset(Quality::Good),
            (1920, 1080),
            Path::new("seg-0001.mp4"),
        )
        .join(" ");
        for part in [
            "-f rawvideo",
            "-pix_fmt bgra",
            "-video_size 1920x1080",
            "-framerate 15",
            "-i pipe:0",
            "-c:v libx264",
            "-preset veryfast",
            "-b:v 2000k",
            "-maxrate 3000k",
            "-bufsize 4000k",
            "-g 30",
            "-pix_fmt yuv420p",
            "-movflags +frag_keyframe+empty_moov+default_base_moof",
            "-f mp4",
        ] {
            assert!(args.contains(part), "{part} in {args}");
        }
        let hw = video_segment_args(
            VideoEncoder::MediaFoundation,
            &preset(Quality::High),
            (1280, 720),
            Path::new("s.mp4"),
        )
        .join(" ");
        assert!(
            hw.contains("-c:v h264_mf") && hw.contains("-hw_encoding 1") && hw.contains("format=nv12") && hw.contains("-g 60")
        );
    }

    #[test]
    fn probe_uses_the_same_codec_args_as_recording() {
        for enc in [
            VideoEncoder::Nvenc,
            VideoEncoder::Qsv,
            VideoEncoder::Amf,
            VideoEncoder::MediaFoundation,
            VideoEncoder::MediaFoundationSoftware,
            VideoEncoder::VideoToolbox,
            VideoEncoder::X264,
        ] {
            let codec = codec_args(enc, &preset(Quality::Good));
            let probe = probe_args(enc);
            let seg = video_segment_args(enc, &preset(Quality::Good), (1280, 720), Path::new("s.mp4"));
            for list in [&probe, &seg] {
                assert!(list.windows(codec.len()).any(|w| w == codec.as_slice()), "{enc:?}: {list:?}");
            }
        }
        let mf = probe_args(VideoEncoder::MediaFoundation).join(" ");
        assert!(mf.contains("-hw_encoding 1") && mf.contains("format=nv12") && mf.contains("-b:v 2000k"));
    }

    #[test]
    fn probes_include_software_mf_and_none_working_is_none() {
        use VideoEncoder::*;
        let listed: Vec<String> = ["h264_mf", "h264_nvenc"].map(String::from).to_vec();
        let order = probe_order(&listed, TargetOs::Windows);
        assert_eq!(order, vec![Nvenc, MediaFoundation, MediaFoundationSoftware]);
        // a PC without a hardware encoder: only the software MFT works
        assert_eq!(
            first_working(&order, |e| e == MediaFoundationSoftware),
            Some(MediaFoundationSoftware)
        );
        assert_eq!(first_working(&order, |_| false), None);
        assert_eq!(probe_order(&[], TargetOs::Windows), Vec::<VideoEncoder>::new());
    }

    #[test]
    fn a_session_falls_back_through_the_rest_and_ends_on_software_mf() {
        let listed: Vec<String> = ["h264_amf", "h264_mf", "h264_nvenc", "h264_qsv"].map(String::from).to_vec();
        use VideoEncoder::*;
        assert_eq!(
            encoder_queue(Qsv, &listed, TargetOs::Windows),
            vec![Qsv, Amf, MediaFoundation, MediaFoundationSoftware]
        );
        assert_eq!(
            encoder_queue(MediaFoundation, &[], TargetOs::Windows),
            vec![MediaFoundation, MediaFoundationSoftware]
        );
        // the software MFT won the probes: the hardware ones are not retried
        assert_eq!(
            encoder_queue(MediaFoundationSoftware, &listed, TargetOs::Windows),
            vec![MediaFoundationSoftware]
        );
        assert_eq!(
            encoder_queue(VideoToolbox, &["h264_videotoolbox".into()], TargetOs::MacOs),
            vec![VideoToolbox]
        );
        let sw = codec_args(MediaFoundationSoftware, &preset(Quality::Good)).join(" ");
        assert!(sw.contains("-c:v h264_mf") && !sw.contains("-hw_encoding"));
        assert_eq!(
            serde_json::to_string(&MediaFoundationSoftware).unwrap(),
            "\"media_foundation_software\""
        );
    }

    #[test]
    fn bundled_ffmpeg_wins_over_path() {
        let c = ffmpeg_candidates(
            Some(Path::new("/app")),
            Some(Path::new("/cwd")),
            Some(PathBuf::from("/usr/bin/ffmpeg")),
        );
        assert_eq!(
            c.first().unwrap(),
            &Path::new("/app").join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" })
        );
        assert_eq!(c.last().unwrap(), &PathBuf::from("/usr/bin/ffmpeg"));
    }
}
