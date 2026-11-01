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
const pref = vi.hoisted(() => ({
	value: {
		projectsPath: null as string | null,
		autoTranscribeAfterRecording: true,
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
	register: vi.fn(async () => {}),
	unregister: vi.fn(async () => {}),
	isRegistered: vi.fn(async () => false),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('~/lib/config-store', async () => {
	const { useState } = await import('react')
	return { usePersisted: <T,>(_key: string, initial: T) => useState<T>(initial) }
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
	findProjectBySource: vi.fn(async (): Promise<string | null> => null),
}))
vi.mock('~/lib/tyto/media-path', () => ({ recordingsFolder: vi.fn(async () => RECORDINGS) }))
vi.mock('~/lib/use-confirm-exit', () => ({ useConfirmExit: () => {} }))
vi.mock('~/providers/preference', () => ({ usePreferenceProvider: () => pref.value }))
vi.mock('~/pages/main/hooks/use-transcribe-queue', () => ({ useTranscribeQueue: () => queue }))
vi.mock('~/pages/main/hooks/use-summaries', () => ({ useSummaries: () => ({}) }))
vi.mock('~/pages/main/hooks/use-drop-target', () => ({ useDropTarget: () => false }))
vi.mock('~/pages/home/hooks/use-audio-download', () => ({ useAudioDownload: () => ({}) }))

import * as dialog from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import { findProjectBySource, saveTranscript } from '~/lib/transcripts-store'
import { createRecordingHandlers, type MockUnfinished } from '~/mock-tauri/handlers/recording'
import { resetRecoveryAsked } from '~/lib/tyto/recording-recovery'
import { SessionProvider } from '~/pages/main/session'
import { setLocale } from '~/paraglide/runtime.js'
import { HotkeyProvider } from '~/providers/hotkey'
import { RecordingShortcutProvider } from '~/providers/recording-shortcut'

const DIR = `${RECORDINGS}/.tyto-rec-2026-10-31 14-05-33`
const unfinished: MockUnfinished = { dir: DIR, name: '2026-10-31 14-05-33', startedAt: '2026-10-31T14:05:33+03:00', approxSeconds: 95, mode: 'audio' }

const message = vi.mocked(dialog.message)
const commands = () => backend.calls.map((call) => call.cmd)

async function renderApp(expectScan = true) {
	render(
		<HotkeyProvider>
			<RecordingShortcutProvider>
				<SessionProvider>{null}</SessionProvider>
			</RecordingShortcutProvider>
		</HotkeyProvider>,
	)
	await waitFor(() => expect(bus.listeners.get('recording_finished')?.size).toBeGreaterThan(0))
	if (expectScan) await waitFor(() => expect(commands()).toContain('recordings_unfinished'))
}

beforeAll(() => setLocale('ru-RU', { reload: false }))

beforeEach(() => {
	vi.clearAllMocks()
	bus.listeners.clear()
	backend.calls = []
	resetRecoveryAsked()
	backend.handlers = {
		...createRecordingHandlers(bus.emit, [{ ...unfinished }]),
		get_audio_devices: () => [],
		get_models_folder: () => '/models',
	}
})

afterEach(cleanup)

describe('восстановление прерванной записи при запуске', () => {
	it('есть незавершенная запись → вопрос с датой; «Восстановить» вызывает recording_recover', async () => {
		message.mockResolvedValueOnce('Восстановить')
		await renderApp()
		await waitFor(() => expect(message).toHaveBeenCalledTimes(1))
		const [body, options] = message.mock.calls[0]
		expect(body).toMatch(/^Запись от .*2026.* прервалась\. Восстановить то, что успело записаться\?$/)
		expect(options).toMatchObject({
			title: 'Найдена незавершенная запись',
			buttons: { yes: 'Восстановить', no: 'Удалить' },
		})
		await waitFor(() => expect(backend.calls.find((call) => call.cmd === 'recording_recover')?.args).toEqual({ dir: DIR }))
		expect(commands()).toContain('recordings_unfinished')
		expect(backend.calls.find((call) => call.cmd === 'recordings_unfinished')?.args).toEqual({ recordingsDir: RECORDINGS })
		expect(commands()).not.toContain('recording_discard')

		// The recovered file becomes a project that is referenced, not copied, and stays untranscribed.
		await waitFor(() => expect(queue.hydrate).toHaveBeenCalledTimes(1))
		expect(saveTranscript).toHaveBeenCalledWith(
			expect.objectContaining({ sourcePath: `${RECORDINGS}/2026-10-31 14-05-33.m4a`, copyMedia: false, durationSeconds: 95 }),
		)
		expect(queue.transcribeJob).not.toHaveBeenCalled()
	})

	it('«Удалить» вызывает recording_discard и больше не спрашивает', async () => {
		message.mockResolvedValueOnce('Удалить')
		await renderApp()
		await waitFor(() => expect(backend.calls.find((call) => call.cmd === 'recording_discard')?.args).toEqual({ dir: DIR }))
		expect(message).toHaveBeenCalledTimes(1)
		expect(commands()).not.toContain('recording_recover')
		expect(await backend.handlers.recordings_unfinished({})).toEqual([])

		// the next start finds nothing to ask about
		cleanup()
		bus.listeners.clear()
		message.mockClear()
		backend.calls = []
		resetRecoveryAsked() // a new app run
		await renderApp()
		expect(message).not.toHaveBeenCalled()
	})

	it('нет незавершенных записей → вопроса нет', async () => {
		backend.handlers = { ...createRecordingHandlers(bus.emit, []), get_audio_devices: () => [], get_models_folder: () => '/models' }
		await renderApp()
		expect(message).not.toHaveBeenCalled()
		expect(commands()).not.toContain('recording_recover')
	})

	it('«Позже» ничего не трогает: ни восстановления, ни удаления', async () => {
		message.mockResolvedValueOnce('Cancel')
		await renderApp()
		await waitFor(() => expect(message).toHaveBeenCalledTimes(1))
		expect(commands()).not.toContain('recording_recover')
		expect(commands()).not.toContain('recording_discard')
	})

	it('уход с главной страницы и возврат (remount) не задают вопрос второй раз в тот же запуск', async () => {
		message.mockResolvedValueOnce('Cancel')
		await renderApp()
		await waitFor(() => expect(message).toHaveBeenCalledTimes(1))
		cleanup()
		bus.listeners.clear()
		backend.calls = []
		await renderApp(false)
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(message).toHaveBeenCalledTimes(1)

		// a remount while the question is still open does not open a second one
		resetRecoveryAsked()
		message.mockClear()
		let answer: (value: string) => void = () => {}
		message.mockReturnValueOnce(new Promise<string>((resolve) => (answer = resolve)))
		cleanup()
		bus.listeners.clear()
		await renderApp()
		await waitFor(() => expect(message).toHaveBeenCalledTimes(1))
		cleanup()
		bus.listeners.clear()
		await renderApp(false)
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(message).toHaveBeenCalledTimes(1)
		answer('Cancel')
	})

	it('пустая запись: сообщение, что сохранять нечего, а не ошибка', async () => {
		message.mockResolvedValueOnce('Yes')
		backend.handlers.recording_recover = () => {
			throw 'too_short: nothing was recorded'
		}
		await renderApp()
		await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('В прерванной записи ничего не осталось, ее убрали', expect.anything()))
		expect(toast.error).not.toHaveBeenCalled()
	})

	it('recovered: true для файла, у которого уже есть проект, второй проект не создает', async () => {
		vi.mocked(findProjectBySource).mockResolvedValueOnce('/mock/documents/Tyto/old/transcript.vibe.json')
		await renderApp()
		const file = `${RECORDINGS}/2026-10-31 14-05-33.m4a`
		await act(async () =>
			bus.emit('recording_finished', {
				path: file,
				name: '2026-10-31 14-05-33.m4a',
				durationSeconds: 95,
				hasVideo: false,
				warning: null,
				stopReason: 'user',
				recovered: true,
			}),
		)
		await waitFor(() => expect(findProjectBySource).toHaveBeenCalledWith(null, file))
		expect(saveTranscript).not.toHaveBeenCalled()
		expect(queue.hydrate).not.toHaveBeenCalled()
	})
})
