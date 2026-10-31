// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
	storeEntries: [] as [string, unknown][],
	downloadModel: vi.fn(),
	isModelFileUsable: vi.fn(),
	navigate: vi.fn(),
	toastWarning: vi.fn(),
	setDiarizeEnabled: vi.fn(),
	preference: {} as Record<string, unknown>,
}))

vi.mock('@tauri-apps/plugin-store', () => ({
	load: async () => ({ entries: async () => h.storeEntries, onChange: async () => () => {}, get: async () => null, set: async () => {}, delete: async () => {} }),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => ({ label: 'main', listen: vi.fn(), setTheme: vi.fn() }) }))
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (command: string) => (command === 'is_online' ? true : command === 'get_models_folder' ? '/models' : null)),
}))
vi.mock('@tauri-apps/api/path', () => ({ join: async (...parts: string[]) => parts.join('/') }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(), message: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ locale: async () => 'ru-RU' }))
vi.mock('sonner', () => ({ toast: { warning: h.toastWarning, error: vi.fn(), success: vi.fn() } }))
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => h.navigate }))
vi.mock('~/lib/model', async (importOriginal) => ({
	...(await importOriginal<typeof import('~/lib/model')>()),
	downloadModel: h.downloadModel,
	isModelFileUsable: h.isModelFileUsable,
}))
vi.mock('~/providers/preference', async (importOriginal) => ({
	...(await importOriginal<typeof import('~/providers/preference')>()),
	usePreferenceProvider: () => h.preference,
}))

import * as config from '~/lib/config'
import { CONFIG_KEYS } from '~/lib/config-keys'
import { m } from '~/paraglide/messages.js'
import { viewModel } from '~/pages/setup/view-model'
import { buildSharedOptions } from '~/pages/main/hooks/use-transcribe-queue'

afterEach(cleanup)

beforeEach(() => {
	h.storeEntries = []
	h.downloadModel.mockReset()
	h.isModelFileUsable.mockReset()
	h.navigate.mockReset()
	h.toastWarning.mockReset()
	h.setDiarizeEnabled.mockReset()
	h.preference = {
		diarizeEnabled: true,
		setDiarizeEnabled: h.setDiarizeEnabled,
		setModelPath: vi.fn(),
		setModelMetadata: vi.fn(),
		setSkippedSetup: vi.fn(),
		modelMetadata: null,
		stableTimestampsEnabled: false,
	}
})

/** Boots the real preference provider on top of a store that holds `entries`. */
async function renderPreference(entries: [string, unknown][]) {
	vi.resetModules()
	h.storeEntries = entries
	const store = await import('~/lib/config-store')
	await store.loadConfigStore()
	const real = await vi.importActual<typeof import('~/providers/preference')>('~/providers/preference')
	const wrapper = ({ children }: { children: ReactNode }) => <real.PreferenceProvider>{children}</real.PreferenceProvider>
	const { result } = renderHook(() => real.usePreferenceProvider(), { wrapper })
	return result
}

describe('говорящие по умолчанию', () => {
	it('чистая установка: diarizeEnabled = true', async () => {
		const result = await renderPreference([])
		expect(result.current.diarizeEnabled).toBe(true)
	})

	it('сохранённое false переживает перезапуск', async () => {
		const result = await renderPreference([[CONFIG_KEYS.diarizeEnabled, false]])
		expect(result.current.diarizeEnabled).toBe(false)
	})
})

describe('setup: модель диаризации', () => {
	const mount = () => renderHook(() => viewModel(), { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> })

	it('после основной модели качается модель диаризации', async () => {
		h.isModelFileUsable.mockResolvedValue(false)
		h.downloadModel.mockResolvedValue('/models/main.bin')
		mount()
		await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/', expect.anything()))
		expect(h.downloadModel).toHaveBeenCalledTimes(2)
		expect(h.downloadModel.mock.calls[1][0]).toMatchObject({ url: config.diarizeModelUrl, ...config.diarizeModelIntegrity })
	})

	it('падение загрузки диаризации не ломает настройку', async () => {
		h.isModelFileUsable.mockResolvedValue(false)
		h.downloadModel.mockResolvedValueOnce('/models/main.bin').mockRejectedValueOnce(new Error('network'))
		mount()
		await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/', expect.anything()))
		expect(h.setDiarizeEnabled).toHaveBeenCalledWith(false)
		expect(h.toastWarning).toHaveBeenCalledWith(m.diarizeDownloadFailed())
	})
	it('отмена во время загрузки диаризации: без отключения, toast и перехода на главный', async () => {
		h.isModelFileUsable.mockResolvedValue(false)
		let hook: ReturnType<typeof mount> | undefined
		h.downloadModel.mockResolvedValueOnce('/models/main.bin').mockImplementationOnce(async () => {
			hook?.result.current.cancelSetup()
			return null
		})
		hook = mount()
		await waitFor(() => expect(h.downloadModel).toHaveBeenCalledTimes(2))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(h.setDiarizeEnabled).not.toHaveBeenCalled()
		expect(h.toastWarning).not.toHaveBeenCalled()
		expect(h.navigate).not.toHaveBeenCalledWith('/', expect.anything())
		expect(h.navigate).toHaveBeenCalledWith('/#settings', expect.anything())
	})

	it('перед второй загрузкой прогресс сбрасывается в 0', async () => {
		h.isModelFileUsable.mockResolvedValue(false)
		let hook: ReturnType<typeof mount> | undefined
		let seen: number | undefined
		h.downloadModel.mockImplementationOnce(async () => {
			hook!.result.current.downloadProgressRef.current = 100
			return '/models/main.bin'
		})
		h.downloadModel.mockImplementationOnce(async () => {
			seen = hook!.result.current.downloadProgressRef.current
			return '/models/diar.gguf'
		})
		hook = mount()
		await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/', expect.anything()))
		expect(seen).toBe(0)
	})
})

describe('очередь: защита от отсутствующей модели', () => {
	// The hook itself needs the whole app tree; the guard lives in buildSharedOptions, so that is what runs here.
	it('diarize включён, но файла модели нет: без diarize_model, говорящие выключены, toast', async () => {
		h.isModelFileUsable.mockResolvedValue(false)
		const options = await buildSharedOptions(h.preference as never)
		expect(options).not.toHaveProperty('diarize_model')
		expect(h.setDiarizeEnabled).toHaveBeenCalledWith(false)
		expect(h.toastWarning).toHaveBeenCalledWith(m.diarizeModelMissing(), expect.anything())
	})
})
