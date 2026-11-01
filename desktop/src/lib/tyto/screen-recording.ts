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

/** What the UI shows: `recording_state` statuses, plus `idle` once finished or failed. */
export type RecorderStatus = 'idle' | RecordingState['status']

/** `RecordingFinished.warning` codes sent by the recorder. */
export const WARNING_DEVICE_LOST = 'device_lost'
export const WARNING_WRITE_FAILED = 'write_failed'

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

/** The pill page is up: the current state (null hides the pill), also sent as `recording_state`. */
export async function recordingPillReady(): Promise<RecordingState | null> {
	return (await invoke<RecordingState | null>('recording_pill_ready')) ?? null
}

/** A recording left in `Записи/` by a crash (`.tyto-rec-*` working folder). */
export interface UnfinishedRecording {
	dir: string
	name: string
	startedAt: string
	approxSeconds: number
	mode: RecordingMode
}

/** `recording_recover` fails with this prefix when nothing was left to save (the folder is removed). */
export const NOTHING_TO_RECOVER = 'too_short'

export async function listUnfinishedRecordings(recordingsDir: string): Promise<UnfinishedRecording[]> {
	return (await invoke<UnfinishedRecording[] | undefined>('recordings_unfinished', { recordingsDir })) ?? []
}

/** Saves the recording like a normal stop; the result arrives as `recording_finished { recovered: true }`. */
export async function recoverRecording(dir: string): Promise<void> {
	await invoke('recording_recover', { dir })
}

export async function discardRecording(dir: string): Promise<void> {
	await invoke('recording_discard', { dir })
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

/** What this build can capture (`screen_capture_support`). */
export interface CaptureSupport {
	video: boolean
	/** The recording pill is left out of the picture by the capture itself. */
	pillExcluded: boolean
}

export interface MonitorInfo {
	id: string
	name: string
	width: number
	height: number
	primary: boolean
}

export interface WindowTarget {
	id: string
	title: string
	appName: string
}

export interface CaptureTargets {
	monitors: MonitorInfo[]
	windows: WindowTarget[]
}

export async function getCaptureSupport(): Promise<CaptureSupport> {
	const support = await invoke<Partial<CaptureSupport> | undefined>('screen_capture_support')
	return { video: support?.video === true, pillExcluded: support?.pillExcluded === true }
}

/** Monitors and open windows to record; Tyto's own windows are left out by the backend. */
export async function listCaptureTargets(): Promise<CaptureTargets> {
	const targets = await invoke<Partial<CaptureTargets> | undefined>('list_capture_targets')
	return { monitors: targets?.monitors ?? [], windows: targets?.windows ?? [] }
}
