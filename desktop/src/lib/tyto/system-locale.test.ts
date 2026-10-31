// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ os: 'ru-RU' as string | null | Error }))
vi.mock('@tauri-apps/plugin-os', () => ({
	locale: async () => {
		if (h.os instanceof Error) throw h.os
		return h.os
	},
}))

import { CONFIG_KEYS } from '~/lib/config-keys'
import { deleteConfig, readConfig, writeConfig } from '~/lib/config-store'
import { localStorageKey, getLocale, setLocale } from '~/paraglide/runtime.js'
import { applySystemLocale, pickSupportedLocale } from './system-locale'

describe('pickSupportedLocale', () => {
	const supported = ['en-US', 'de-DE', 'ru-RU', 'pt-BR']

	it('точное совпадение: ru-RU', () => {
		expect(pickSupportedLocale(['ru-RU'], supported)).toBe('ru-RU')
	})
	it('по языку: ru -> ru-RU', () => {
		expect(pickSupportedLocale(['ru'], supported)).toBe('ru-RU')
	})
	it('de-AT при единственной de-DE -> de-DE', () => {
		expect(pickSupportedLocale(['de-AT'], supported)).toBe('de-DE')
	})
	it('неизвестная xx-YY -> en-US', () => {
		expect(pickSupportedLocale(['xx-YY'], supported)).toBe('en-US')
	})
	it('регистр и подчёркивание не важны: ru_ru', () => {
		expect(pickSupportedLocale(['ru_ru'], supported)).toBe('ru-RU')
	})
	it('берёт первый подходящий из списка', () => {
		expect(pickSupportedLocale(['xx-YY', 'de-AT'], supported)).toBe('de-DE')
	})
})

describe('applySystemLocale', () => {
	beforeEach(() => {
		localStorage.clear()
		deleteConfig(CONFIG_KEYS.displayLanguage)
		setLocale('en-US', { reload: false })
		localStorage.clear()
		h.os = 'ru-RU'
	})

	it('первый запуск: язык системы применяется и сохраняется', async () => {
		await applySystemLocale()
		expect(getLocale()).toBe('ru-RU')
		expect(localStorage.getItem(localStorageKey)).toBe('ru-RU')
	})

	it('первый запуск: язык пишется и в конфиг displayLanguage', async () => {
		await applySystemLocale()
		expect(readConfig(CONFIG_KEYS.displayLanguage, null)).toBe('ru-RU')
	})

	it('явный displayLanguage в конфиге не перезаписывается', async () => {
		writeConfig(CONFIG_KEYS.displayLanguage, 'de-DE')
		await applySystemLocale()
		expect(readConfig(CONFIG_KEYS.displayLanguage, null)).toBe('de-DE')
		expect(getLocale()).toBe('de-DE')
		expect(localStorage.getItem(localStorageKey)).toBe('de-DE')
	})

	it('сохранённый язык есть: определение пропускается', async () => {
		localStorage.setItem(localStorageKey, 'de-DE')
		await applySystemLocale()
		expect(localStorage.getItem(localStorageKey)).toBe('de-DE')
	})

	it('система выдала неизвестный язык: en-US', async () => {
		h.os = 'xx-YY'
		await applySystemLocale()
		expect(localStorage.getItem(localStorageKey)).toBe('en-US')
	})

	it('плагин ОС упал: берём navigator.languages, приложение не падает', async () => {
		h.os = new Error('no plugin')
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ru'])
		await applySystemLocale()
		expect(localStorage.getItem(localStorageKey)).toBe('ru-RU')
	})
})
