// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const os = vi.hoisted(() => ({ name: 'macos' }))
const backend = vi.hoisted(() => ({ status: 'not_determined', requested: 'denied' }))
const config = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => os.name }))
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (cmd: string) => {
		if (cmd === 'get_screen_recording_permission_status') return backend.status
		if (cmd === 'request_screen_recording_permission') return backend.requested
		return null
	}),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(async () => true) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('~/lib/config-store', () => ({
	readConfig: (key: string, fallback: unknown) => (config.has(key) ? config.get(key) : fallback),
	writeConfig: (key: string, value: unknown) => config.set(key, value),
}))

import { invoke } from '@tauri-apps/api/core'
import { ask } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import { setLocale } from '~/paraglide/runtime.js'
import { ensureScreenRecordingPermission, SCREEN_PERMISSION_EXPLAINED_KEY } from './screen-permission'

const calls = () => vi.mocked(invoke).mock.calls.map((c) => c[0])

beforeAll(() => setLocale('ru-RU', { reload: false }))

beforeEach(() => {
	os.name = 'macos'
	backend.status = 'not_determined'
	backend.requested = 'denied'
	config.clear()
	vi.mocked(invoke).mockClear()
	vi.mocked(ask).mockClear()
	vi.mocked(toast.error).mockClear()
})

describe('разрешение на запись экрана (mac)', () => {
	it('mac, разрешения нет: объяснение показано один раз, «Открыть настройки» вызывает open_screen_recording_settings', async () => {
		expect(await ensureScreenRecordingPermission()).toBe(false)
		expect(ask).toHaveBeenCalledTimes(1)
		const [body, options] = vi.mocked(ask).mock.calls[0]
		expect(body).toContain('Конфиденциальность и безопасность')
		expect(body).toContain('перезапустите Tyto')
		expect(options).toMatchObject({ title: 'Нужно разрешение на запись экрана', okLabel: 'Открыть настройки' })
		// the request puts Tyto into the System Settings list, then the settings open
		expect(calls()).toEqual(['get_screen_recording_permission_status', 'request_screen_recording_permission', 'open_screen_recording_settings'])
		expect(config.get(SCREEN_PERMISSION_EXPLAINED_KEY)).toBe(true)
	})

	it('второй раз объяснения нет, сразу request_screen_recording_permission', async () => {
		config.set(SCREEN_PERMISSION_EXPLAINED_KEY, true)
		expect(await ensureScreenRecordingPermission()).toBe(false)
		expect(ask).not.toHaveBeenCalled()
		expect(calls()).toEqual(['get_screen_recording_permission_status', 'request_screen_recording_permission'])
		// not silent: a toast says why and offers the settings
		expect(toast.error).toHaveBeenCalledWith('Нужно разрешение на запись экрана', expect.objectContaining({ action: expect.anything() }))

		backend.requested = 'granted'
		expect(await ensureScreenRecordingPermission()).toBe(true)
	})

	it('разрешение уже есть: ничего не спрашиваем', async () => {
		backend.status = 'granted'
		expect(await ensureScreenRecordingPermission()).toBe(true)
		expect(ask).not.toHaveBeenCalled()
		expect(calls()).toEqual(['get_screen_recording_permission_status'])
	})

	it('отказ в объяснении: настройки не открываются, второй раз объяснения нет', async () => {
		vi.mocked(ask).mockResolvedValueOnce(false)
		expect(await ensureScreenRecordingPermission()).toBe(false)
		expect(calls()).toEqual(['get_screen_recording_permission_status'])
		await ensureScreenRecordingPermission()
		expect(ask).toHaveBeenCalledTimes(1)
	})

	it('Windows: проверка разрешения не вызывается', async () => {
		os.name = 'windows'
		expect(await ensureScreenRecordingPermission()).toBe(true)
		expect(invoke).not.toHaveBeenCalled()
		expect(ask).not.toHaveBeenCalled()
	})
})
