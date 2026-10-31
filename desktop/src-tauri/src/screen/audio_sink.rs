use std::fs::File;
use std::io::BufWriter;
use std::path::Path;
use std::time::Instant;

use eyre::{bail, Context, Result};
use hound::{SampleFormat, WavSpec, WavWriter};

use super::segments::{align_audio, AudioSource, AudioTrackRecord};

struct OpenSegment {
    writer: WavWriter<BufWriter<File>>,
    file: String,
    start: Instant,
    started: bool,
    /// Samples (not frames) in the file.
    samples: u64,
    failed: bool,
}

/// One audio source written as f32 WAV, one file per segment. Samples that
/// arrive while no segment is open (pause) are dropped.
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
            failed: false,
        });
        Ok(())
    }

    /// The first write after `open` first fills the time from the segment start
    /// to `now` with silence (device latency), so audio stays in sync with video.
    pub fn write(&mut self, samples: &[f32], now: Instant) {
        let (rate, channels, source) = (self.sample_rate, self.channels, self.source);
        let Some(seg) = self.open.as_mut() else {
            return;
        };
        if seg.failed {
            return;
        }
        let mut result: Result<(), hound::Error> = Ok(());
        if !seg.started {
            seg.started = true;
            let lead = now.saturating_duration_since(seg.start);
            let lead_frames = (lead.as_nanos() * u128::from(rate) / 1_000_000_000) as u64;
            result = write_silence(seg, lead_frames * u64::from(channels));
        }
        if result.is_ok() {
            result = samples.iter().try_for_each(|s| {
                seg.writer.write_sample(*s)?;
                seg.samples += 1;
                Ok(())
            });
        }
        if let Err(e) = result {
            seg.failed = true;
            tracing::error!("audio write for {} failed: {e:#}", source.name());
        }
    }

    /// Pads or marks the segment to `target_ms`, finalizes the WAV and returns its record.
    /// `None` if no segment was open.
    pub fn close(&mut self, target_ms: u64) -> Result<Option<AudioTrackRecord>> {
        let Some(mut seg) = self.open.take() else {
            return Ok(None);
        };
        let channels = u64::from(self.channels);
        let align = align_audio(target_ms, self.sample_rate, seg.samples / channels);
        write_silence(&mut seg, align.pad_frames * channels).context("pad audio segment")?;
        let frames = seg.samples / channels;
        seg.writer.finalize().context("finalize audio segment")?;
        Ok(Some(AudioTrackRecord {
            source: self.source,
            file: seg.file,
            sample_rate: self.sample_rate,
            channels: self.channels,
            frames,
            outpoint_secs: align.outpoint_secs,
        }))
    }

    pub fn is_open(&self) -> bool {
        self.open.is_some()
    }
}

fn write_silence(seg: &mut OpenSegment, samples: u64) -> Result<(), hound::Error> {
    for _ in 0..samples {
        seg.writer.write_sample(0.0f32)?;
        seg.samples += 1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

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
    fn close_pads_short_audio_and_marks_long_audio() {
        let dir = tempfile::tempdir().unwrap();
        let mut sink = SegmentedWavSink::new(AudioSource::System, 1_000, 2);
        let t0 = Instant::now();
        sink.open(&dir.path().join("a.wav"), t0).unwrap();
        sink.write(&[0.1; 200], t0);
        // 100 frames written, target 500 ms at 1 kHz: 400 frames of silence
        let rec = sink.close(500).unwrap().unwrap();
        assert_eq!((rec.frames, rec.outpoint_secs), (500, None));
        assert_eq!(read(&dir.path().join("a.wav")).len(), 1_000);

        sink.open(&dir.path().join("b.wav"), t0).unwrap();
        sink.write(&[0.1; 2_000], t0);
        let rec = sink.close(500).unwrap().unwrap();
        assert_eq!((rec.frames, rec.outpoint_secs), (1_000, Some(0.5)));

        // opened but never written (silent device): the whole segment is silence
        sink.open(&dir.path().join("c.wav"), t0).unwrap();
        assert_eq!(sink.close(250).unwrap().unwrap().frames, 250);
    }
}
