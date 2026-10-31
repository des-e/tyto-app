/** How long a download must run before we dare to name a remaining time. */
const MIN_ELAPSED_MS = 3000
/** Speed is the average over this trailing window, so one fast or slow chunk does not swing the estimate. */
const WINDOW_MS = 2500

export interface DownloadSample {
	/** Milliseconds, any monotonic clock. */
	t: number
	/** Bytes downloaded so far. */
	bytes: number
}

/**
 * Seconds left for a download of `total` bytes, from progress samples in time order. `null` until the
 * download has run for 3 s, or while nothing is moving.
 */
export function estimateEta(samples: DownloadSample[], total: number): number | null {
	if (samples.length < 2) return null
	const last = samples[samples.length - 1]
	if (last.t - samples[0].t < MIN_ELAPSED_MS) return null

	// The newest sample that is still at least a full window older than the last one.
	let start = samples[0]
	for (const sample of samples) {
		if (last.t - sample.t < WINDOW_MS) break
		start = sample
	}
	const speed = (last.bytes - start.bytes) / ((last.t - start.t) / 1000)
	if (!(speed > 0)) return null
	return Math.max(0, total - last.bytes) / speed
}
