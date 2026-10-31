import { emitMockEvent } from '../event-bus'
import { virtualFs } from '../state'
import type { CommandHandlerMap } from '../types'

// Stand-in for the segmented recorder (`screen/recorder.rs`): `recording_state` once a second,
// `recording_finished` with an `.m4a` in the given `Записи` folder after `recording_stop`.

type Emit = (event: string, payload?: unknown) => void

interface MockStartOptions {
	mode: 'audio' | 'video'
	recordingsDir: string
	name: string | null
}

const TICK_MS = 1000
const LEVEL_TICK_MS = 100
const FINISH_DELAY_MS = 200

function stamp(date: Date) {
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export function createRecordingHandlers(emit: Emit): CommandHandlerMap {
	let session: {
		options: MockStartOptions
		status: 'recording' | 'paused' | 'finishing'
		activeMs: number
		runningSince: number | null
		startedAt: Date
		timers: ReturnType<typeof setInterval>[]
	} | null = null

	const activeMs = () => (session ? session.activeMs + (session.runningSince === null ? 0 : Date.now() - session.runningSince) : 0)
	const state = () => (session ? { status: session.status, mode: session.options.mode, activeMs: activeMs() } : null)
	const emitState = () => emit('recording_state', state())

	return {
		recording_start: (args) => {
			const options = args?.options as MockStartOptions
			if (session) throw 'recording is already in progress'
			if (options.mode === 'video') throw 'video capture is not available'
			session = { options, status: 'recording', activeMs: 0, runningSince: Date.now(), startedAt: new Date(), timers: [] }
			let level = 0
			session.timers.push(
				setInterval(emitState, TICK_MS),
				setInterval(() => emit('record_level', 0.2 + 0.3 * Math.abs(Math.sin((level += 1) * 0.5))), LEVEL_TICK_MS),
			)
			emitState()
			return undefined
		},
		recording_pause: () => {
			if (!session) throw 'no recording in progress'
			if (session.status !== 'recording') throw 'recording is already paused'
			session.activeMs = activeMs()
			session.runningSince = null
			session.status = 'paused'
			emitState()
			return undefined
		},
		recording_resume: () => {
			if (!session) throw 'no recording in progress'
			if (session.status !== 'paused') throw 'recording is not paused'
			session.runningSince = Date.now()
			session.status = 'recording'
			emitState()
			return undefined
		},
		recording_stop: () => {
			if (!session) throw 'no recording in progress'
			if (session.status === 'finishing') throw 'recording is being finished'
			const stopped = session
			stopped.activeMs = activeMs()
			stopped.runningSince = null
			stopped.status = 'finishing'
			for (const timer of stopped.timers) clearInterval(timer)
			emitState()
			setTimeout(() => {
				session = null
				if (stopped.activeMs < 1000) {
					emit('recording_failed', { code: 'too_short', message: 'recording is too short, nothing to save' })
					return
				}
				const name = `${stopped.options.name?.trim() || stamp(stopped.startedAt)}.m4a`
				const path = `${stopped.options.recordingsDir.replace(/\/+$/, '')}/${name}`
				virtualFs.set(path, null)
				emit('recording_finished', {
					path,
					name,
					durationSeconds: Math.round(stopped.activeMs / 1000),
					hasVideo: false,
					warning: null,
					stopReason: 'user',
					recovered: false,
				})
			}, FINISH_DELAY_MS)
			return undefined
		},
		recording_state: () => state(),
	}
}

export const recordingHandlers: CommandHandlerMap = createRecordingHandlers(emitMockEvent)
