import type { RecordingState } from '~/lib/tyto/screen-recording'

/**
 * The pill timer between two `recording_state` events (once a second): while recording, the time
 * since the last event is added; paused or saving, the recorder's own `activeMs` stands still.
 */
export function displayElapsed(state: RecordingState, receivedAt: number, now: number): number {
	if (state.status !== 'recording') return state.activeMs
	return state.activeMs + Math.max(0, now - receivedAt)
}

/** `0:07`, `12:05`, `1:02:03`. */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000))
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const seconds = String(total % 60).padStart(2, '0')
	if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
	return `${minutes}:${seconds}`
}
