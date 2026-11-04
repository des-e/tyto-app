import { m } from '~/paraglide/messages.js'

/** Below this much progress or time the speed is still the model warming up, so no estimate yet. */
const MIN_PERCENT = 3
const MIN_ELAPSED_MS = 5000

/**
 * Seconds left for one running file, from how fast its percentage has moved so far:
 * elapsed × (100 − p) / p. Null while there is too little to go on.
 */
export function fileSecondsLeft(progress: number, startedAt: number | undefined, now: number): number | null {
	if (startedAt == null || progress < MIN_PERCENT || progress >= 100) return null
	const elapsed = now - startedAt
	if (elapsed < MIN_ELAPSED_MS) return null
	return ((elapsed / 1000) * (100 - progress)) / progress
}

/**
 * Seconds left for a batch: the running file's own estimate plus the queued files at the pace seen
 * so far (finished files, else the running file's projected total).
 */
export function batchSecondsLeft({
	queued,
	secondsPerFile,
	running,
	now,
}: {
	queued: number
	secondsPerFile: number | null
	running?: { progress: number; startedAt?: number }
	now: number
}): number | null {
	const current = running ? fileSecondsLeft(running.progress, running.startedAt, now) : 0
	let pace = secondsPerFile
	if (pace == null && running && current != null && running.startedAt != null) pace = (now - running.startedAt) / 1000 + current
	if (current == null || (queued > 0 && pace == null)) return null
	return current + queued * (pace ?? 0)
}

/** «осталось около 3 мин», «осталось около 1 ч 5 мин», «осталось меньше минуты». */
export function timeLeftLabel(seconds: number): string {
	const minutes = Math.round(seconds / 60)
	if (minutes < 1) return m.progressLessThanMinute()
	const time =
		minutes >= 60
			? m.progressHoursMinutes({ hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) })
			: m.progressMinutes({ minutes: String(minutes) })
	return m.progressTimeLeft({ time })
}
