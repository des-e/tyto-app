import { emitMockEvent } from '../event-bus'
import { virtualFs } from '../state'
import type { CommandHandlerMap } from '../types'

// Stand-in for the segmented recorder (`screen/recorder.rs`): `recording_state` once a second,
// `recording_finished` with an `.m4a` (`.mp4` for video) in the given `Записи` folder after `recording_stop`.

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

export interface MockUnfinished {
	dir: string
	name: string
	startedAt: string
	approxSeconds: number
	mode: 'audio' | 'video'
}

/** `unfinished`: crash leftovers the mock reports (recover and discard remove them). */
export function createRecordingHandlers(emit: Emit, unfinished: MockUnfinished[] = []): CommandHandlerMap {
	let session: {
		options: MockStartOptions
		status: 'recording' | 'paused' | 'finishing'
		activeMs: number
		runningSince: number | null
		startedAt: Date
		timers: ReturnType<typeof setInterval>[]
	} | null = null
	// `?window=recording-pill&mockRecording=1` shows the pill mid-recording (12:34), for screenshots.
	if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mockRecording')) {
		session = {
			options: { mode: 'audio' } as MockStartOptions,
			status: 'recording',
			activeMs: 754_000,
			runningSince: null,
			startedAt: new Date(),
			timers: [],
		}
	}

	const activeMs = () => (session ? session.activeMs + (session.runningSince === null ? 0 : Date.now() - session.runningSince) : 0)
	const state = () => (session ? { status: session.status, mode: session.options.mode, activeMs: activeMs() } : null)
	const emitState = () => emit('recording_state', state())

	return {
		recording_start: (args) => {
			const options = args?.options as MockStartOptions
			if (session) throw 'recording is already in progress'
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
			// Like the recorder: no session, or one already saving, is a no-op.
			if (!session || session.status === 'finishing') return undefined
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
				const video = stopped.options.mode === 'video'
				const name = `${stopped.options.name?.trim() || stamp(stopped.startedAt)}.${video ? 'mp4' : 'm4a'}`
				const path = `${stopped.options.recordingsDir.replace(/\/+$/, '')}/${name}`
				virtualFs.set(path, null)
				emit('recording_finished', {
					path,
					name,
					durationSeconds: Math.round(stopped.activeMs / 1000),
					hasVideo: video,
					warning: null,
					stopReason: 'user',
					recovered: false,
				})
			}, FINISH_DELAY_MS)
			return undefined
		},
		recordings_unfinished: () => [...unfinished],
		recording_recover: (args) => {
			const dir = String(args?.dir)
			const index = unfinished.findIndex((item) => item.dir === dir)
			if (index < 0) throw `${dir} is not an unfinished recording`
			const [item] = unfinished.splice(index, 1)
			const path = `${dir.replace(/[/\\][^/\\]*$/, '')}/${item.name}.m4a`
			virtualFs.set(path, null)
			emit('recording_finished', {
				path,
				name: `${item.name}.m4a`,
				durationSeconds: item.approxSeconds,
				hasVideo: false,
				warning: null,
				stopReason: 'user',
				recovered: true,
			})
			return undefined
		},
		recording_discard: (args) => {
			const index = unfinished.findIndex((item) => item.dir === String(args?.dir))
			if (index >= 0) unfinished.splice(index, 1)
			return undefined
		},
		// The browser mock shows the whole video flow; real builds answer `video: false` until the capture exists.
		screen_capture_support: () => ({ video: true, pillExcluded: true }),
		list_capture_targets: () => ({
			monitors: [
				{ id: 'mock-monitor-1', name: 'Mock display 1', width: 1920, height: 1080, primary: true },
				{ id: 'mock-monitor-2', name: 'Mock display 2', width: 2560, height: 1440, primary: false },
			],
			windows: [
				{ id: 'mock-window-1', title: 'Созвон с командой', appName: 'Zoom' },
				{ id: 'mock-window-2', title: 'Квартальный отчет.xlsx', appName: 'Excel' },
				{ id: 'mock-window-3', title: 'Входящие', appName: 'Chrome' },
			],
		}),
		recording_state: () => state(),
		recording_pill_ready: () => state(),
	}
}

export const recordingHandlers: CommandHandlerMap = createRecordingHandlers(emitMockEvent)
