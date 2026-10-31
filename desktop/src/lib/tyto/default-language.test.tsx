// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ storeEntries: [] as [string, unknown][] }))

vi.mock('@tauri-apps/plugin-store', () => ({
	load: async () => ({ entries: async () => h.storeEntries, onChange: async () => () => {}, get: async () => null, set: async () => {}, delete: async () => {} }),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => ({ label: 'main', listen: vi.fn(), setTheme: vi.fn() }) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(), message: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ locale: async () => 'ru-RU' }))

import { CONFIG_KEYS } from '~/lib/config-keys'

afterEach(cleanup)
// Warm the module graph so the first test does not pay the cold vite transform cost (see renderPreference).
beforeAll(async () => {
	await import('~/providers/preference')
}, 30_000)
beforeEach(() => {
	h.storeEntries = []
	// The previous test's locale switch is kept by paraglide's localStorage strategy.
	localStorage.clear()
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
	return { result, real }
}

describe('язык расшифровки по умолчанию', () => {
	it('чистая установка: автоопределение', async () => {
		const { result, real } = await renderPreference([])
		expect(real.DEFAULT_MODEL_OPTIONS.lang).toBe('auto')
		expect(result.current.modelOptions.lang).toBe('auto')
	}, 30_000)

	it('сохранённый выбор переживает перезапуск', async () => {
		const saved = { ...(await import('~/providers/preference')).DEFAULT_MODEL_OPTIONS, lang: 'ru' }
		const { result } = await renderPreference([[CONFIG_KEYS.modelOptions, saved]])
		expect(result.current.modelOptions.lang).toBe('ru')
	})

	it('старая установка с сохранённым en остаётся на en', async () => {
		const saved = { ...(await import('~/providers/preference')).DEFAULT_MODEL_OPTIONS, lang: 'en' }
		const { result } = await renderPreference([[CONFIG_KEYS.modelOptions, saved]])
		expect(result.current.modelOptions.lang).toBe('en')
	})

	it('смена языка приложения не трогает auto', async () => {
		const { result } = await renderPreference([])
		act(() => result.current.setDisplayLanguage('ru-RU'))
		await new Promise((r) => setTimeout(r, 20))
		expect(result.current.displayLanguage).toBe('ru-RU')
		expect(result.current.modelOptions.lang).toBe('auto')
	})

	it('смена языка приложения переключает фиксированный язык (поведение Vibe)', async () => {
		const saved = { ...(await import('~/providers/preference')).DEFAULT_MODEL_OPTIONS, lang: 'en' }
		const { result } = await renderPreference([[CONFIG_KEYS.modelOptions, saved]])
		act(() => result.current.setDisplayLanguage('ru-RU'))
		await waitFor(() => expect(result.current.modelOptions.lang).toBe('ru'))
	})
})
