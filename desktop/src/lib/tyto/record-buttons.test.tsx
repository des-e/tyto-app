// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({
	handlers: {} as Record<string, (args: Record<string, unknown>) => unknown>,
	calls: [] as { cmd: string; args?: Record<string, unknown> }[],
}))
const h = vi.hoisted(() => ({
	recording: null as unknown,
	pref: {
		projectsPath: null as string | null,
		modelPath: '/models/ggml-medium.bin',
		homeTab: 'record',
		setHomeTab: () => {},
		screenQuality: 'good',
	},
}))
const RECORDINGS = vi.hoisted(() => '/mock/documents/Tyto/Записи')

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
		backend.calls.push({ cmd, args })
		return backend.handlers[cmd]?.(args ?? {})
	}),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
// Windows: no Screen Recording check before the picker (the Mac one is in screen-permission.test).
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('~/lib/config-store', async () => {
	const { useState } = await import('react')
	return { usePersisted: <T,>(_key: string, initial: T) => useState<T>(initial) }
})
vi.mock('~/lib/keep-awake', () => ({ KEEP_AWAKE: { record: 'record' }, startKeepAwake: vi.fn(), stopKeepAwake: vi.fn() }))
vi.mock('~/lib/permissions', () => ({ ensureSystemAudioPermission: vi.fn(async () => true) }))
vi.mock('~/lib/tyto/media-path', () => ({ recordingsFolder: vi.fn(async () => RECORDINGS) }))
vi.mock('~/providers/preference', () => ({ usePreferenceProvider: () => h.pref }))
vi.mock('~/pages/main/session', () => ({ useSession: () => ({ recording: h.recording, recordElapsed: 0, preference: h.pref }) }))
// The panel's neighbours are not under test here.
vi.mock('~/pages/main/components/quiet-row', () => ({ default: () => null }))
vi.mock('~/lib/tyto/empty-screen', () => ({ EmptyScreen: () => null }))
vi.mock('~/lib/ytdlp', () => ({ parseMediaLinks: () => [] }))

import { RecordCard } from '~/pages/main/components/idle-hero'
import { useRecording } from '~/pages/home/hooks/use-recording'
import { createRecordingHandlers } from '~/mock-tauri/handlers/recording'
import { setLocale } from '~/paraglide/runtime.js'
import { TooltipProvider } from '~/components/ui/tooltip'

const mic = { isDefault: true, isInput: true, id: '0', name: 'Микрофон' }
const speakers = { isDefault: true, isInput: false, id: '1', name: 'Динамики' }
const monitor = (id: string, width: number, height: number, primary = false) => ({ id, name: id, width, height, primary })

function Harness() {
	h.recording = useRecording(() => {})
	return <RecordCard />
}

function renderPanel() {
	render(
		<TooltipProvider>
			<Harness />
		</TooltipProvider>,
	)
}

const startCall = () => backend.calls.find((call) => call.cmd === 'recording_start')

beforeAll(() => setLocale('ru-RU', { reload: false }))

beforeEach(() => {
	backend.calls = []
	h.pref.screenQuality = 'good'
	backend.handlers = {
		...createRecordingHandlers(() => {}),
		get_audio_devices: () => [mic, speakers],
		screen_capture_support: () => ({ video: true, pillExcluded: true }),
		list_capture_targets: () => ({
			monitors: [monitor('m1', 1920, 1080, true), monitor('m2', 2560, 1440)],
			windows: [{ id: 'w1', title: 'Созвон с командой', appName: 'Zoom' }],
		}),
	}
})

afterEach(cleanup)

async function ready() {
	const start = await screen.findByRole('button', { name: /Начать запись/ })
	await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false))
	return start
}

/** «Записывать экран» on, then «Начать запись» opens «Что записывать». */
async function openPicker() {
	const start = await ready()
	fireEvent.click(await screen.findByRole('switch', { name: 'Записывать экран' }))
	fireEvent.click(start)
	return within(await screen.findByRole('dialog'))
}

describe('карточка «Записать звонок» на главном экране', () => {
	it('«Начать запись» и тумблер «Записывать экран»', async () => {
		renderPanel()
		await ready()
		expect(await screen.findByRole('switch', { name: 'Записывать экран' })).toBeTruthy()
		expect(screen.getByText(/Микрофон и звук собеседников/)).toBeTruthy()
	})

	it('video: false → тумблера нет, «Начать запись» пишет звук', async () => {
		backend.handlers.screen_capture_support = () => ({ video: false, pillExcluded: false })
		renderPanel()
		const start = await ready()
		await waitFor(() => expect(backend.calls.some((call) => call.cmd === 'screen_capture_support')).toBe(true))
		expect(screen.queryByRole('switch', { name: 'Записывать экран' })).toBeNull()
		fireEvent.click(start)
		await waitFor(() => expect(startCall()).toBeTruthy())
		expect(startCall()?.args).toMatchObject({ options: { mode: 'audio', target: null } })
	})

	it('тумблер выключен: «Начать запись» сразу вызывает recording_start с mode audio и без target', async () => {
		renderPanel()
		fireEvent.click(await ready())
		await waitFor(() => expect(startCall()).toBeTruthy())
		expect(startCall()?.args).toEqual({
			options: { mode: 'audio', target: null, devices: [mic, speakers], recordingsDir: RECORDINGS, quality: 'good', name: null },
		})
		expect(screen.queryByText('Что записывать')).toBeNull()
	})

	it('«Устройства» раскрывают выбор микрофона и звука', async () => {
		renderPanel()
		await ready()
		fireEvent.click(screen.getByRole('button', { name: 'Устройства' }))
		expect(screen.getByRole('button', { name: 'Устройства' }).getAttribute('aria-expanded')).toBe('true')
	})

	it('тумблер включен: открывается «Что записывать»; один монитор → target = этот монитор', async () => {
		backend.handlers.list_capture_targets = () => ({ monitors: [monitor('only', 1920, 1080, true)], windows: [] })
		renderPanel()
		const dialog = await openPicker()
		expect(dialog.getByText('Что записывать')).toBeTruthy()
		expect(dialog.queryByText(/Экран 1/)).toBeNull()
		const start = dialog.getByRole('button', { name: 'Начать запись' }) as HTMLButtonElement
		await waitFor(() => expect(start.disabled).toBe(false))
		fireEvent.click(start)
		await waitFor(() => expect(startCall()).toBeTruthy())
		expect(startCall()?.args).toMatchObject({ options: { mode: 'video', target: { kind: 'monitor', id: 'only' }, quality: 'good' } })
	})

	it('два монитора: «Начать запись» → recording_start { mode: video, target: { kind: monitor, id }, quality }', async () => {
		h.pref.screenQuality = 'high'
		renderPanel()
		const dialog = await openPicker()
		fireEvent.click(await dialog.findByRole('radio', { name: 'Экран 2, 2560×1440' }))
		fireEvent.click(dialog.getByRole('button', { name: 'Начать запись' }))
		await waitFor(() => expect(startCall()).toBeTruthy())
		expect(startCall()?.args).toEqual({
			options: { mode: 'video', target: { kind: 'monitor', id: 'm2' }, devices: [mic, speakers], recordingsDir: RECORDINGS, quality: 'high', name: null },
		})
	})

	it('«Одно окно»: выбор окна → target { kind: window, id }', async () => {
		renderPanel()
		const dialog = await openPicker()
		fireEvent.click(await dialog.findByRole('radio', { name: 'Одно окно' }))
		fireEvent.click(dialog.getByRole('radio', { name: /Созвон с командой/ }))
		fireEvent.click(dialog.getByRole('button', { name: 'Начать запись' }))
		await waitFor(() => expect(startCall()).toBeTruthy())
		expect(startCall()?.args).toMatchObject({ options: { mode: 'video', target: { kind: 'window', id: 'w1' } } })
	})
})
