use std::fs::File;
use std::io::BufWriter;
use std::path::Path;
use std::time::{Duration, Instant};

use eyre::{bail, Context, Result};
use hound::{SampleFormat, WavSpec, WavWriter};

use super::segments::{align_audio, AudioSource, AudioTrackRecord};

/// A gap longer than this between the clock and the written audio is filled
/// with silence (WASAPI loopback sends no packets while nothing plays).
/// Shorter lags are buffer jitter and are left alone.
pub const GAP_FILL_MS: u64 = 100;
/// The WAV header is rewritten this often, so a crash loses at most this much audio.
pub const FLUSH_EVERY: Duration = Duration::from_secs(2);
/// RIFF sizes are u32: stop writing a segment 1 MB before the 4 GB limit.
const WAV_DATA_LIMIT: u64 = u32::MAX as u64 - 1024 * 1024;
const BYTES_PER_SAMPLE: u64 = 4;

struct OpenSegment {
    writer: WavWriter<BufWriter<File>>,
    file: String,
    start: Instant,
    started: bool,
    /// Samples (not frames) in the file, silence included.
    samples: u64,
    /// Samples that came from the device.
    captured: u64,
    last_flush: Instant,
    failed: bool,
    full: bool,
}

impl OpenSegment {
    fn room(&self) -> u64 {
        (WAV_DATA_LIMIT / BYTES_PER_SAMPLE).saturating_sub(self.samples)
    }

    fn silence(&mut self, samples: u64) -> Result<(), hound::Error> {
        for _ in 0..samples.min(self.room()) {
            self.writer.write_sample(0.0f32)?;
            self.samples += 1;
        }
        Ok(())
    }

    fn data(&mut self, samples: &[f32]) -> Result<(), hound::Error> {
        let n = samples.len().min(self.room() as usize);
        for s in &samples[..n] {
            self.writer.write_sample(*s)?;
            self.samples += 1;
            self.captured += 1;
        }
        Ok(())
    }
}

/// One audio source written as f32 WAV, one file per segment. Samples that
/// arrive while no segment is open (pause) are dropped. `write` does file I/O:
/// call it from a worker fed by a channel, not from the device callback.
pub struct SegmentedWavSink {
    source: AudioSource,
    sample_rate: u32,
    channels: u16,
    open: Option<OpenSegment>,
}

impl SegmentedWavSink {
    pub fn new(source: AudioSource, sample_rate: u32, channels: u16) -> Self {
        Self {
            source,
            sample_rate,
            channels: channels.max(1),
            open: None,
        }
    }

    pub fn open(&mut self, path: &Path, segment_start: Instant) -> Result<()> {
        if self.open.is_some() {
            bail!("audio segment for {} is already open", self.source.name());
        }
        let spec = WavSpec {
            channels: self.channels,
            sample_rate: self.sample_rate,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        };
        let writer = WavWriter::create(path, spec).with_context(|| format!("create {}", path.display()))?;
        let file = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        self.open = Some(OpenSegment {
            writer,
            file,
            start: segment_start,
            started: false,
            samples: 0,
            captured: 0,
            last_flush: segment_start,
            failed: false,
            full: false,
        });
        Ok(())
    }

    /// Keeps the file on the segment clock: the first write after `open` fills
    /// the time from the segment start to `now` with silence (device latency),
    /// later writes fill gaps longer than `GAP_FILL_MS` (the device sent nothing).
    pub fn write(&mut self, samples: &[f32], now: Instant) {
        let (rate, channels, source) = (self.sample_rate, self.channels, self.source);
        let Some(seg) = self.open.as_mut() else {
            return;
        };
        if seg.failed || seg.full {
            return;
        }
        let ch = u64::from(channels);
        let elapsed = now.saturating_duration_since(seg.start);
        let expected = (elapsed.as_nanos() * u128::from(rate) / 1_000_000_000) as u64;
        let behind = expected.saturating_sub(seg.samples / ch);
        let threshold = u64::from(rate) * GAP_FILL_MS / 1000;
        let mut result = Ok(());
        if !seg.started || behind > threshold {
            seg.started = true;
            result = seg.silence(behind * ch);
        }
        if result.is_ok() {
            result = seg.data(samples);
        }
        if result.is_ok() && now.saturating_duration_since(seg.last_flush) >= FLUSH_EVERY {
            seg.last_flush = now;
            result = seg.writer.flush();
        }
        if let Err(e) = result {
            seg.failed = true;
            tracing::error!(
                "audio write for {} failed, rest of the segment is silence: {e:#}",
                source.name()
            );
        }
        if seg.room() == 0 && !seg.full {
            seg.full = true;
            tracing::error!("audio segment for {} reached the WAV size limit", source.name());
        }
    }

    /// Fills silence up to `until` while the device sends nothing (silent
    /// loopback), a little at every writer tick, so a long silence never turns
    /// into one huge write when the next block or the close comes. The caller
    /// keeps `until` behind the clock, so blocks still on their way fit after it.
    pub fn catch_up(&mut self, until: Instant) {
        let (rate, channels, source) = (self.sample_rate, self.channels, self.source);
        let Some(seg) = self.open.as_mut() else {
            return;
        };
        if seg.failed || seg.full {
            return;
        }
        let ch = u64::from(channels);
        let elapsed = until.saturating_duration_since(seg.start);
        let expected = (elapsed.as_nanos() * u128::from(rate) / 1_000_000_000) as u64;
        let behind = expected.saturating_sub(seg.samples / ch);
        if behind == 0 {
            return;
        }
        if let Err(e) = seg.silence(behind * ch) {
            seg.failed = true;
            tracing::error!("audio write for {} failed: {e:#}", source.name());
        }
        if seg.room() == 0 && !seg.full {
            seg.full = true;
            tracing::error!("audio segment for {} reached the WAV size limit", source.name());
        }
    }

    /// Pads the segment to `target_ms` (or marks the overhang for `outpoint`),
    /// finalizes the WAV and returns its record; `None` if no segment was open.
    /// A failed write does not lose the segment: what was written is kept and the
    /// concat `duration` keeps the following segments in place.
    pub fn close(&mut self, target_ms: u64) -> Result<Option<AudioTrackRecord>> {
        let Some(mut seg) = self.open.take() else {
            return Ok(None);
        };
        let name = self.source.name();
        let ch = u64::from(self.channels);
        if !seg.failed {
            let align = align_audio(target_ms, self.sample_rate, seg.samples / ch);
            if let Err(e) = seg.silence(align.pad_frames * ch) {
                tracing::error!("padding audio segment for {name} failed: {e:#}");
            }
        }
        let frames = seg.samples / ch;
        if let Err(e) = seg.writer.finalize() {
            tracing::error!("finalizing audio segment for {name} failed: {e:#}");
        }
        Ok(Some(AudioTrackRecord {
            source: self.source,
            file: seg.file,
            sample_rate: self.sample_rate,
            channels: self.channels,
            frames,
            outpoint_secs: align_audio(target_ms, self.sample_rate, frames).outpoint_secs,
            captured_frames: seg.captured / ch,
            target_ms,
        }))
    }

    pub fn is_open(&self) -> bool {
        self.open.is_some()
    }

    /// The open segment stopped taking samples (write error or WAV size limit):
    /// the recorder rotates to a new segment so the rest is not lost.
    pub fn has_failed(&self) -> bool {
        self.open.as_ref().is_some_and(|seg| seg.failed || seg.full)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(path: &Path) -> Vec<f32> {
        hound::WavReader::open(path)
            .unwrap()
            .samples::<f32>()
            .map(|s| s.unwrap())
            .collect()
    }

    #[test]
    fn sink_pads_device_latency_and_drops_samples_while_paused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seg-0001.mic.wav");
        let mut sink = SegmentedWavSink::new(AudioSource::Mic, 48_000, 1);
        let t0 = Instant::now();
        // paused before the segment opens: dropped
        sink.write(&[1.0; 100], t0);
        sink.open(&path, t0).unwrap();
        sink.write(&[0.5; 480], t0 + Duration::from_millis(100));
        let rec = sink.close(110).unwrap().unwrap();
        assert_eq!(rec.frames, 5_280);
        assert_eq!(rec.captured_frames, 480);
        assert_eq!(rec.outpoint_secs, None);
        assert_eq!(rec.file, "seg-0001.mic.wav");
        sink.write(&[1.0; 480], t0 + Duration::from_millis(200));
        assert_eq!(sink.close(200).unwrap(), None);

        let samples = read(&path);
        assert_eq!(samples.len(), 4_800 + 480);
        assert!(samples[..4_800].iter().all(|s| *s == 0.0));
        assert!(samples[4_800..].iter().all(|s| *s == 0.5));
    }

    #[test]
    fn gaps_inside_a_segment_are_filled_with_silence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seg-0001.system.wav");
        let mut sink = SegmentedWavSink::new(AudioSource::System, 48_000, 1);
        let t0 = Instant::now();
        sink.open(&path, t0).unwrap();
        sink.write(&[0.5; 480], t0 + Duration::from_millis(10));
        // jitter below the threshold: no silence
        sink.write(&[0.5; 480], t0 + Duration::from_millis(60));
        // loopback was silent for 2 s
        sink.write(&[0.5; 480], t0 + Duration::from_secs(2));
        let rec = sink.close(2_010).unwrap().unwrap();
        assert_eq!(rec.captured_frames, 1_440);
        let s = read(&path);
        assert!(s[480..1_440].iter().all(|v| *v == 0.5));
        // written 1 440 frames, clock at 96 000: 94 560 frames of silence before the third block
        assert!(s[1_440..96_000].iter().all(|v| *v == 0.0));
        assert!(s[96_000..96_480].iter().all(|v| *v == 0.5));
        assert_eq!(s.len(), 96_480);
    }

    #[test]
    fn close_pads_short_audio_and_marks_long_audio() {
        let dir = tempfile::tempdir().unwrap();
        let mut sink = SegmentedWavSink::new(AudioSource::System, 1_000, 2);
        let t0 = Instant::now();
        sink.open(&dir.path().join("a.wav"), t0).unwrap();
        sink.write(&[0.1; 200], t0);
        // 100 frames written, target 500 ms at 1 kHz: 400 frames of silence
        let rec = sink.close(500).unwrap().unwrap();
        assert_eq!((rec.frames, rec.outpoint_secs, rec.target_ms), (500, None, 500));
        assert_eq!(read(&dir.path().join("a.wav")).len(), 1_000);

        sink.open(&dir.path().join("b.wav"), t0).unwrap();
        sink.write(&[0.1; 2_000], t0);
        let rec = sink.close(500).unwrap().unwrap();
        assert_eq!((rec.frames, rec.outpoint_secs), (1_000, Some(0.5)));

        // opened but never written (silent device): the whole segment is silence
        sink.open(&dir.path().join("c.wav"), t0).unwrap();
        let rec = sink.close(250).unwrap().unwrap();
        assert_eq!((rec.frames, rec.captured_frames), (250, 0));
    }

    #[test]
    fn a_long_silence_is_filled_step_by_step_not_in_one_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seg-0001.system.wav");
        let mut sink = SegmentedWavSink::new(AudioSource::System, 1_000, 1);
        let t0 = Instant::now();
        sink.open(&path, t0).unwrap();
        // ten minutes of silent loopback, the writer ticks every 20 ms
        let mut biggest = 0;
        let mut written = 0;
        for tick in 1..=30_000u64 {
            sink.catch_up(t0 + Duration::from_millis(tick * 20));
            let now_written = sink.open.as_ref().unwrap().samples;
            biggest = biggest.max(now_written - written);
            written = now_written;
        }
        assert!(biggest <= 20, "a tick wrote {biggest} samples");
        assert_eq!(written, 600_000);
        // the next block lands right after the silence, nothing more to pad
        sink.write(&[0.5; 10], t0 + Duration::from_secs(600));
        let rec = sink.close(600_010).unwrap().unwrap();
        assert_eq!((rec.frames, rec.captured_frames), (600_010, 10));
        let s = read(&path);
        assert!(s[..600_000].iter().all(|v| *v == 0.0) && s[600_000..].iter().all(|v| *v == 0.5));
    }

    #[test]
    fn a_failed_write_keeps_what_was_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seg-0001.mic.wav");
        let mut sink = SegmentedWavSink::new(AudioSource::Mic, 1_000, 1);
        let t0 = Instant::now();
        sink.open(&path, t0).unwrap();
        sink.write(&[0.5; 100], t0);
        assert!(!sink.has_failed());
        sink.open.as_mut().unwrap().failed = true;
        assert!(sink.has_failed());
        sink.write(&[0.5; 100], t0 + Duration::from_millis(100));
        let rec = sink.close(1_000).unwrap().unwrap();
        assert_eq!((rec.frames, rec.captured_frames, rec.target_ms), (100, 100, 1_000));
        assert_eq!(read(&path).len(), 100);
    }
}
