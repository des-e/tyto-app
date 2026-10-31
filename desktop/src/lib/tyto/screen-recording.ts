import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AudioDevice } from '~/lib/audio'

/**
 * Recording on the segmented recorder (`desktop/src-tauri/src/screen/`): audio now, video later.
 * Dictation stays on the old `start_record`.
 */
export type RecordingMode = 'audio' | 'video'
export type Quality = 'good' | 'high'
export type CaptureTarget = { kind: 'monitor'; id: string } | { kind: 'window'; id: string }

export interface StartRecordingOptions {
	mode: RecordingMode
	target?: CaptureTarget | null
	devices: AudioDevice[]
	/** `<projects>/Записи`, see `recordingsFolder`. */
	recordingsDir: string
	quality: Quality
	name?: string | null
}

export interface RecordingState {
	status: 'recording' | 'paused' | 'finishing'
	mode: RecordingMode
	/** Recorded time without pauses. */
	activeMs: number
}

export interface RecordingFinished {
	path: string
	name: string
	durationSeconds: number
	hasVideo: boolean
	warning: string | null
	stopReason: 'user' | 'low_disk'
	recovered: boolean
}

export interface RecordingFailed {
	code: 'too_short' | 'capture' | 'encoder' | 'other'
	message: string
}

export const RECORDING_STATE_EVENT = 'recording_state'
export const RECORDING_FINISHED_EVENT = 'recording_finished'
export const RECORDING_FAILED_EVENT = 'recording_failed'

export async function startRecording(options: StartRecordingOptions): Promise<void> {
	await invoke('recording_start', {
		options: {
			mode: options.mode,
			target: options.target ?? null,
			devices: options.devices,
			recordingsDir: options.recordingsDir,
			quality: options.quality,
			name: options.name?.trim() || null,
		},
	})
}

export async function pauseRecording(): Promise<void> {
	await invoke('recording_pause')
}

export async function resumeRecording(): Promise<void> {
	await invoke('recording_resume')
}

export async function stopRecording(): Promise<void> {
	await invoke('recording_stop')
}

export async function getRecordingState(): Promise<RecordingState | null> {
	return (await invoke<RecordingState | null>('recording_state')) ?? null
}

export function onRecordingState(cb: (state: RecordingState) => void): Promise<UnlistenFn> {
	return listen<RecordingState>(RECORDING_STATE_EVENT, ({ payload }) => cb(payload))
}

export function onRecordingFinished(cb: (finished: RecordingFinished) => void): Promise<UnlistenFn> {
	return listen<RecordingFinished>(RECORDING_FINISHED_EVENT, ({ payload }) => cb(payload))
}

export function onRecordingFailed(cb: (failed: RecordingFailed) => void): Promise<UnlistenFn> {
	return listen<RecordingFailed>(RECORDING_FAILED_EVENT, ({ payload }) => cb(payload))
}
