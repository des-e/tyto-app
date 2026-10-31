use std::time::Duration;

/// Keeps a constant frame rate: tells how many times the latest frame must be
/// written so that exactly `floor(elapsed * fps)` frames exist by `elapsed`.
#[derive(Clone, Debug)]
pub struct FramePacer {
    fps: u32,
    written: u64,
}

impl FramePacer {
    pub fn new(fps: u32) -> Self {
        Self { fps, written: 0 }
    }

    /// Number of times to write the last frame now (duplicates when there are
    /// no new frames, 0 when we are ahead of the clock).
    pub fn due(&mut self, elapsed: Duration) -> u64 {
        let target = (elapsed.as_nanos() * u128::from(self.fps) / 1_000_000_000) as u64;
        let n = target.saturating_sub(self.written);
        self.written += n;
        n
    }

    pub fn frames(&self) -> u64 {
        self.written
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pacer_keeps_constant_rate_without_new_frames() {
        let mut p = FramePacer::new(15);
        assert_eq!(p.due(Duration::from_millis(0)), 0);
        assert_eq!(p.due(Duration::from_millis(1000)), 15);
        // window closed or minimized: no frames for 5 s, but time goes on
        assert_eq!(p.due(Duration::from_millis(6000)), 75);
        assert_eq!(p.frames(), 90);
        assert_eq!(p.due(Duration::from_millis(6010)), 0);
    }

    #[test]
    fn pacer_drift_after_an_hour_is_below_one_frame() {
        let mut p = FramePacer::new(30);
        let mut t = 0u64;
        while t < 3_600_000 {
            t += 33;
            p.due(Duration::from_millis(t));
        }
        let expected = t * 30 / 1000;
        assert!(expected - p.frames() <= 1);
    }
}
