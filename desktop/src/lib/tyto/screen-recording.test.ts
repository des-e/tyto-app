import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bus = vi.hoisted(() => {
	const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>()
	return {
		listeners,
		emit(event: string, payload?: unknown) {
			for (const cb of [...(listeners.get(event) ?? [])]) cb({ payload })
		},
	}
})
const backend = vi.hoisted(() => ({ handlers: {} as Record<string, (args: Record<string, unknown>) => unknown> }))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
		const handler = backend.handlers[cmd]
		if (!handler) throw new Error(`unhandled ${cmd}`)
		return handler(args ?? {})
	}),
}))
vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(async (event: string, cb: (event: { payload: unknown }) => void) => {
		let set = bus.listeners.get(event)
		if (!set) bus.listeners.set(event, (set = new Set()))
		set.add(cb)
		return () => set.delete(cb)
	}),
	emit: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { createRecordingHandlers } from '~/mock-tauri/handlers/recording'
import {
	getRecordingState,
	onRecordingFailed,
	onRecordingFinished,
	onRecordingState,
	pauseRecording,
	resumeRecording,
	startRecording,
	stopRecording,
	type RecordingFinished,
	type RecordingState,
} from './screen-recording'

const mic = { isDefault: true, isInput: true, id: '0', name: 'Микрофон' }
const speakers = { isDefault: true, isInput: false, id: '1', name: 'Динамики' }
const recordingsDir = '/mock/documents/Tyto/Записи'

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date(2026, 9, 31, 14, 5, 33))
	bus.listeners.clear()
	backend.handlers = createRecordingHandlers(bus.emit)
	vi.mocked(invoke).mockClear()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('screen-recording', () => {
	it('startRecording передает режим, устройства, папку Записи и качество в recording_start', async () => {
		await startRecording({ mode: 'audio', devices: [mic, speakers], recordingsDir, quality: 'good', name: '  ' })
		expect(invoke).toHaveBeenCalledWith('recording_start', {
			options: { mode: 'audio', target: null, devices: [mic, speakers], recordingsDir, quality: 'good', name: null },
		})
		expect(await getRecordingState()).toEqual({ status: 'recording', mode: 'audio', activeMs: 0 })
	})

	it('видео в моках: цель и качество уходят в recording_start, состояние в режиме video', async () => {
		await startRecording({ mode: 'video', target: { kind: 'monitor', id: '1' }, devices: [mic], recordingsDir, quality: 'high' })
		expect(invoke).toHaveBeenCalledWith('recording_start', {
			options: { mode: 'video', target: { kind: 'monitor', id: '1' }, devices: [mic], recordingsDir, quality: 'high', name: null },
		})
		expect(await getRecordingState()).toMatchObject({ status: 'recording', mode: 'video' })
	})

	it('пауза не идет в длину записи, recording_finished несет файл в Записи', async () => {
		const states: RecordingState[] = []
		const finished: RecordingFinished[] = []
		await onRecordingState((state) => states.push(state))
		await onRecordingFinished((payload) => finished.push(payload))

		await startRecording({ mode: 'audio', devices: [mic], recordingsDir, quality: 'good' })
		await vi.advanceTimersByTimeAsync(40_000)
		await pauseRecording()
		expect(states[states.length - 1]).toMatchObject({ status: 'paused', activeMs: 40_000 })
		await vi.advanceTimersByTimeAsync(30_000)
		await resumeRecording()
		await vi.advanceTimersByTimeAsync(25_000)
		await stopRecording()
		expect(states[states.length - 1]).toMatchObject({ status: 'finishing', activeMs: 65_000 })
		await vi.advanceTimersByTimeAsync(500)

		expect(finished).toEqual([
			{
				path: `${recordingsDir}/2026-10-31 14-05-33.m4a`,
				name: '2026-10-31 14-05-33.m4a',
				durationSeconds: 65,
				hasVideo: false,
				warning: null,
				stopReason: 'user',
				recovered: false,
			},
		])
		expect(await getRecordingState()).toBeNull()
	})

	it('стоп сразу после старта: recording_failed too_short', async () => {
		const failed: unknown[] = []
		await onRecordingFailed((payload) => failed.push(payload))
		await startRecording({ mode: 'audio', devices: [mic], recordingsDir, quality: 'good' })
		await stopRecording()
		await vi.advanceTimersByTimeAsync(500)
		expect(failed).toEqual([{ code: 'too_short', message: expect.any(String) }])
	})

	it('отписка снимает слушателя', async () => {
		const seen: unknown[] = []
		const unlisten = await onRecordingFinished((payload) => seen.push(payload))
		unlisten()
		bus.emit('recording_finished', { path: 'x' })
		expect(seen).toEqual([])
	})
})
