import { describe, expect, it } from 'vitest'
import { estimateEta } from './download-eta'

const MB = 1_000_000
const lastOf = <T,>(items: T[]) => items[items.length - 1]

/** One sample every 250 ms at `speed` bytes per second, from `from` ms for `duration` ms. */
function steady(speed: number, duration: number, from = { t: 0, bytes: 0 }) {
	const samples: Array<{ t: number; bytes: number }> = []
	for (let dt = 0; dt <= duration; dt += 250) samples.push({ t: from.t + dt, bytes: from.bytes + (speed * dt) / 1000 })
	return samples
}

describe('estimateEta', () => {
	it('stays null until 3 s of download have passed', () => {
		expect(estimateEta([], 1000 * MB)).toBeNull()
		expect(estimateEta(steady(10 * MB, 2750), 1000 * MB)).toBeNull()
		expect(estimateEta(steady(10 * MB, 3000), 1000 * MB)).not.toBeNull()
	})

	it('steady 10 MB/s with 600 MB left gives about 60 s', () => {
		const samples = steady(10 * MB, 10_000)
		const total = lastOf(samples).bytes + 600 * MB
		const eta = estimateEta(samples, total)!
		expect(Math.abs(eta - 60)).toBeLessThanOrEqual(1)
	})

	it('smooths a speed jump over a 2-3 s window', () => {
		const before = steady(10 * MB, 10_000)
		const last = lastOf(before)
		const after = steady(50 * MB, 3_000, last).slice(1)
		const total = 2000 * MB

		// 1 s after the jump: neither the old 10 MB/s nor the instant 50 MB/s.
		const oneSecond = [...before, ...after.slice(0, 4)]
		const remaining1 = total - lastOf(oneSecond).bytes
		const eta1 = estimateEta(oneSecond, total)!
		expect(eta1).toBeLessThan(remaining1 / (10 * MB))
		expect(eta1).toBeGreaterThan(remaining1 / (50 * MB))

		// 3 s after the jump the window holds only the new speed.
		const threeSeconds = [...before, ...after]
		const remaining3 = total - lastOf(threeSeconds).bytes
		expect(estimateEta(threeSeconds, total)!).toBeCloseTo(remaining3 / (50 * MB), 0)
	})

	it('gives null when nothing moved', () => {
		const stalled = steady(0, 5_000)
		expect(estimateEta(stalled, 1000 * MB)).toBeNull()
	})
})
