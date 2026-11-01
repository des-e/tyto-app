// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const bus = vi.hoisted(() => {
	const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>()
	return {
		listeners,
		emit(event: string, payload?: unknown) {
			for (const cb of [...(listeners.get(event) ?? [])]) cb({ payload })
		},
	}
})
const backend = vi.hoisted(() => ({
	handlers: {} as Record<string, (args: Record<string, unknown>) => unknown>,
	calls: [] as { cmd: string; args?: Record<string, unknown> }[],
}))
const shortcuts = vi.hoisted(() => new Map<string, (event: { state: 'Pressed' | 'Released' }) => void>())
const persisted = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
const pref = vi.hoisted(() => ({
	value: {
		projectsPath: null as string | null,
		autoTranscribeAfterRecording: false,
		modelOptions: { lang: 'ru' },
		modelPath: '/models/ggml-medium.bin',
		homeTab: 'none',
		setHomeTab: () => {},
		setModelPath: () => {},
		skippedSetup: true,
		closeToTray: false,
		advancedTranscribeOptions: { includeSubFolders: false },
		gpuDevice: 0,
		noGpu: false,
		unloadTimeoutMinutes: 0,
		modelMetadata: null,
	},
}))
const queue = vi.hoisted(() => ({
	hydrate: vi.fn((..._args: unknown[]) => 'job-1' as string | null),
	transcribeJob: vi.fn(),
	enqueue: vi.fn(),
	reset: vi.fn(),
	jobs: [] as unknown[],
	running: false,
}))
const RECORDINGS = vi.hoisted(() => '/mock/documents/Tyto/Записи')

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
		backend.calls.push({ cmd, args })
		return backend.handlers[cmd]?.(args ?? {})
	}),
	convertFileSrc: (path: string) => `asset://${path}`,
}))
vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(async (event: string, cb: (event: { payload: unknown }) => void) => {
		let set = bus.listeners.get(event)
		if (!set) bus.listeners.set(event, (set = new Set()))
		set.add(cb)
		return () => set.delete(cb)
	}),
	emit: vi.fn(async (event: string, payload?: unknown) => bus.emit(event, payload)),
}))
vi.mock('@tauri-apps/api', () => ({
	webviewWindow: { getCurrentWebviewWindow: () => ({ show: async () => {}, setFocus: async () => {} }) },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), message: vi.fn() }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: vi.fn() }))
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
	register: vi.fn(async (shortcut: string, cb: (event: { state: 'Pressed' | 'Released' }) => void) => {
		shortcuts.set(shortcut, cb)
	}),
	unregister: vi.fn(async (shortcut: string) => {
		shortcuts.delete(shortcut)
	}),
	isRegistered: vi.fn(async (shortcut: string) => shortcuts.has(shortcut)),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('~/lib/config-store', async () => {
	const { useState } = await import('react')
	return {
		usePersisted: <T,>(key: string, initial: T) => useState<T>(key in persisted.values ? (persisted.values[key] as T) : initial),
	}
})
vi.mock('~/lib/keep-awake', () => ({ KEEP_AWAKE: { record: 'record' }, startKeepAwake: vi.fn(), stopKeepAwake: vi.fn() }))
vi.mock('~/lib/permissions', () => ({ ensureSystemAudioPermission: vi.fn(async () => true) }))
vi.mock('~/lib/dictation-indicator', () => ({ showDictationIndicator: vi.fn(), hideDictationIndicator: vi.fn() }))
vi.mock('~/lib/analytics', () => ({ trackTranscribeStarted: vi.fn(), trackTranscribeFailed: vi.fn(), trackTranscribeSucceeded: vi.fn() }))
vi.mock('~/lib/model', async (importOriginal) => ({
	...(await importOriginal<typeof import('~/lib/model')>()),
	cleanupPartialDownloads: vi.fn(async () => {}),
	listInstalledModels: vi.fn(async () => [{ name: 'medium', path: '/models/ggml-medium.bin', valid: true }]),
}))
vi.mock('~/lib/transcripts-store', () => ({
	TRANSCRIPT_VERSION: 2,
	saveTranscript: vi.fn(async (input: { sourcePath: string; name: string }) => ({
		recordPath: `/mock/documents/Tyto/${input.name}/transcript.vibe.json`,
		mediaPath: input.sourcePath,
	})),
	notifyTranscriptsChanged: vi.fn(),
	findProjectBySource: vi.fn(async () => null),
}))
vi.mock('~/lib/tyto/media-path', () => ({ recordingsFolder: vi.fn(async () => RECORDINGS) }))
vi.mock('~/lib/use-confirm-exit', () => ({ useConfirmExit: () => {} }))
vi.mock('~/providers/preference', () => ({ usePreferenceProvider: () => pref.value }))
vi.mock('~/pages/main/hooks/use-transcribe-queue', () => ({ useTranscribeQueue: () => queue }))
vi.mock('~/pages/main/hooks/use-summaries', () => ({ useSummaries: () => ({}) }))
vi.mock('~/pages/main/hooks/use-drop-target', () => ({ useDropTarget: () => false }))
vi.mock('~/pages/home/hooks/use-audio-download', () => ({ useAudioDownload: () => ({}) }))

import { toast } from 'sonner'
import { CONFIG_KEYS } from '~/lib/config-keys'
import { getDefaultHotkeyShortcut, getDefaultRecordingShortcut } from '~/lib/config'
import { saveTranscript } from '~/lib/transcripts-store'
import { createRecordingHandlers } from '~/mock-tauri/handlers/recording'
import { SessionProvider, useSession, type Session } from '~/pages/main/session'
import { setLocale } from '~/paraglide/runtime.js'
import { HotkeyProvider } from '~/providers/hotkey'
import { RecordingShortcutProvider } from '~/providers/recording-shortcut'
import type { RecordingFinished } from './screen-recording'

const mic = { isDefault: true, isInput: true, id: '0', name: 'Микрофон' }
const speakers = { isDefault: true, isInput: false, id: '1', name: 'Динамики' }
const FILE = `${RECORDINGS}/2026-10-31 14-05-33.m4a`

function finished(overrides: Partial<RecordingFinished> = {}): RecordingFinished {
	return {
		path: FILE,
		name: '2026-10-31 14-05-33.m4a',
		durationSeconds: 65,
		hasVideo: false,
		warning: null,
		stopReason: 'user',
		recovered: false,
		...overrides,
	}
}

const sessionRef: { current: Session | null } = { current: null }

function Probe() {
	sessionRef.current = useSession()
	return null
}

async function renderApp() {
	render(
		<HotkeyProvider>
			<RecordingShortcutProvider>
				<SessionProvider>
					<Probe />
				</SessionProvider>
			</RecordingShortcutProvider>
		</HotkeyProvider>,
	)
	// Every provider has subscribed once its listen() promises resolved.
	await waitFor(() => expect(bus.listeners.get('recording_finished')?.size).toBeGreaterThan(0))
}

const commands = () => backend.calls.map((call) => call.cmd)

beforeAll(() => setLocale('ru-RU', { reload: false }))

beforeEach(() => {
	vi.clearAllMocks()
	bus.listeners.clear()
	shortcuts.clear()
	backend.calls = []
	backend.handlers = {
		...createRecordingHandlers(bus.emit),
		get_audio_devices: () => [mic, speakers],
		get_models_folder: () => '/models',
		start_record: () => undefined,
	}
	persisted.values = {}
	pref.value.autoTranscribeAfterRecording = false
	pref.value.homeTab = 'none'
	sessionRef.current = null
})

afterEach(cleanup)

describe('запись аудио через новый модуль', () => {
	it('кнопка записи идет в recording_start с устройствами и папкой Записи', async () => {
		pref.value.homeTab = 'record'
		await renderApp()
		await waitFor(() => expect(sessionRef.current?.recording.inputDevice).toEqual(mic))
		await act(() => sessionRef.current!.recording.startRecord())
		const start = backend.calls.find((call) => call.cmd === 'recording_start')
		expect(start?.args).toEqual({
			options: { mode: 'audio', target: null, devices: [mic, speakers], recordingsDir: RECORDINGS, quality: 'good', name: null },
		})
		expect(commands()).not.toContain('start_record')

		await act(() => sessionRef.current!.recording.pauseRecord())
		expect(sessionRef.current?.recording.isPaused).toBe(true)
		await act(() => sessionRef.current!.recording.resumeRecord())
		expect(sessionRef.current?.recording.isPaused).toBe(false)
		expect(commands()).toEqual(expect.arrayContaining(['recording_pause', 'recording_resume']))
	})

	it('после recording_finished создается проект без копии файла, с durationSeconds, и он выбран', async () => {
		await renderApp()
		await act(async () => bus.emit('recording_finished', finished()))
		await waitFor(() => expect(queue.hydrate).toHaveBeenCalled())
		expect(saveTranscript).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: FILE, copyMedia: false, durationSeconds: 65 }))
		expect(vi.mocked(saveTranscript).mock.calls[0][0]).not.toHaveProperty('moveSourceMedia')
		// hydrate puts the project into the session and selects it
		expect(queue.hydrate).toHaveBeenCalledWith(
			expect.objectContaining({ sourcePath: FILE, durationSeconds: 65, segments: [] }),
			expect.stringMatching(/2026-10-31 14-05-33\/transcript\.vibe\.json$/),
			FILE,
			'record',
		)
	})

	it('аудио: autoTranscribeAfterRecording включен → расшифровка стартует; выключен → нет', async () => {
		await renderApp()
		await act(async () => bus.emit('recording_finished', finished()))
		await waitFor(() => expect(queue.hydrate).toHaveBeenCalledTimes(1))
		expect(queue.transcribeJob).not.toHaveBeenCalled()

		pref.value.autoTranscribeAfterRecording = true
		cleanup()
		await renderApp()
		await act(async () => bus.emit('recording_finished', finished()))
		await waitFor(() => expect(queue.transcribeJob).toHaveBeenCalledWith('job-1'))
	})

	it('видео: расшифровка сама не стартует, даже если autoTranscribeAfterRecording включен', async () => {
		pref.value.autoTranscribeAfterRecording = true
		await renderApp()
		await act(async () => bus.emit('recording_finished', finished({ hasVideo: true, path: `${RECORDINGS}/v.mp4`, name: 'v.mp4' })))
		await waitFor(() => expect(queue.hydrate).toHaveBeenCalled())
		expect(queue.transcribeJob).not.toHaveBeenCalled()
	})

	it('recording_failed too_short → toast «Запись слишком короткая, сохранять нечего», проект не создан', async () => {
		await renderApp()
		await act(async () => bus.emit('recording_failed', { code: 'too_short', message: 'recording is too short, nothing to save' }))
		await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Запись слишком короткая, сохранять нечего', expect.anything()))
		expect(saveTranscript).not.toHaveBeenCalled()
		expect(queue.hydrate).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
	})

	it('stopReason low_disk → toast «Мало места на диске. Запись остановлена и сохранена»', async () => {
		await renderApp()
		await act(async () => bus.emit('recording_finished', finished({ stopReason: 'low_disk' })))
		await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Мало места на диске. Запись остановлена и сохранена', expect.anything()))
		await waitFor(() => expect(queue.hydrate).toHaveBeenCalled())
	})

	it('второй «Остановить» во время сохранения ничего не делает: ни ошибки, ни сброса', async () => {
		pref.value.homeTab = 'record'
		backend.handlers.recording_stop = vi.fn(() => bus.emit('recording_state', { status: 'finishing', mode: 'audio', activeMs: 5_000 }))
		await renderApp()
		await waitFor(() => expect(sessionRef.current?.recording.inputDevice).toEqual(mic))
		await act(() => sessionRef.current!.recording.startRecord())
		await act(() => sessionRef.current!.recording.stopRecord())
		expect(sessionRef.current?.recording.isFinishing).toBe(true)
		expect(sessionRef.current?.recording.isRecording).toBe(true)
		await act(() => sessionRef.current!.recording.stopRecord())
		await act(() => sessionRef.current!.recording.pauseRecord())
		expect(backend.handlers.recording_stop).toHaveBeenCalledTimes(1)
		expect(commands()).not.toContain('recording_pause')
		expect(toast.error).not.toHaveBeenCalled()
		expect(sessionRef.current?.recording.isRecording).toBe(true)

		await act(async () => bus.emit('recording_finished', finished()))
		await waitFor(() => expect(sessionRef.current?.recording.isRecording).toBe(false))
		expect(sessionRef.current?.recording.status).toBe('idle')
	})

	it('отключенное устройство: свое предупреждение по-русски, проект создан', async () => {
		await renderApp()
		await act(async () => bus.emit('recording_finished', finished({ warning: 'device_lost' })))
		await waitFor(() =>
			expect(toast.warning).toHaveBeenCalledWith('Устройство звука отключилось. Запись остановлена и сохранена', expect.anything()),
		)
		await waitFor(() => expect(queue.hydrate).toHaveBeenCalled())
	})

	it('глобальная клавиша записи и плашка созвона идут через recording_start, а не start_record', async () => {
		persisted.values = { [CONFIG_KEYS.recordingShortcutEnabled]: true }
		await renderApp()
		const shortcut = getDefaultRecordingShortcut()
		await waitFor(() => expect(shortcuts.has(shortcut)).toBe(true))

		await act(async () => shortcuts.get(shortcut)!({ state: 'Pressed' }))
		await waitFor(() => expect(commands()).toContain('recording_start'))
		expect(backend.calls.find((call) => call.cmd === 'recording_start')?.args).toEqual({
			options: { mode: 'audio', target: null, devices: [mic], recordingsDir: RECORDINGS, quality: 'good', name: null },
		})
		await act(async () => shortcuts.get(shortcut)!({ state: 'Released' }))

		// second press stops; the mock reports a too-short recording, which ends the session
		await act(async () => shortcuts.get(shortcut)!({ state: 'Pressed' }))
		await waitFor(() => expect(commands()).toContain('recording_stop'))
		await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Запись слишком короткая, сохранять нечего', expect.anything()))

		backend.calls = []
		await act(async () => bus.emit('meeting-prompt-start-recording', { microphone: true, systemAudio: true }))
		await waitFor(() => expect(commands()).toContain('recording_start'))
		expect(backend.calls.find((call) => call.cmd === 'recording_start')?.args).toMatchObject({ options: { devices: [mic, speakers] } })
		expect(commands()).not.toContain('start_record')
	})

	it('диктовка по-прежнему вызывает start_record', async () => {
		persisted.values = { [CONFIG_KEYS.hotkeyEnabled]: true }
		await renderApp()
		const shortcut = getDefaultHotkeyShortcut()
		await waitFor(() => expect(shortcuts.has(shortcut)).toBe(true))
		await act(async () => shortcuts.get(shortcut)!({ state: 'Pressed' }))
		await waitFor(() => expect(commands()).toContain('start_record'))
		expect(backend.calls.find((call) => call.cmd === 'start_record')?.args).toEqual({ devices: [mic], recordingName: null })
		expect(commands()).not.toContain('recording_start')
	})
})
