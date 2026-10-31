// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { CONFIG_KEYS } from '~/lib/config-keys'
import { deleteConfig, readConfig, writeConfig } from '~/lib/config-store'
import { runMigrations } from '~/lib/migrations'
import { LANG_AUTO_MIGRATED_KEY, migrateLangToAuto } from './lang-auto-migration'

const lang = () => readConfig<{ lang?: string } | null>(CONFIG_KEYS.modelOptions, null)?.lang

beforeEach(() => {
	localStorage.clear()
	for (const key of [CONFIG_KEYS.modelOptions, CONFIG_KEYS.recentLanguages, LANG_AUTO_MIGRATED_KEY]) deleteConfig(key)
})

describe('one-time switch of the 0.1.x stored English to auto-detection', () => {
	it('stored en that was never picked from the list becomes auto, once, keeping the other options', () => {
		writeConfig(CONFIG_KEYS.modelOptions, { lang: 'en', verbose: false })
		migrateLangToAuto()
		expect(readConfig(CONFIG_KEYS.modelOptions, null)).toEqual({ lang: 'auto', verbose: false })
		expect(readConfig(LANG_AUTO_MIGRATED_KEY, false)).toBe(true)
	})

	it('en chosen explicitly (it is in the recent languages) stays en', () => {
		writeConfig(CONFIG_KEYS.modelOptions, { lang: 'en' })
		writeConfig(CONFIG_KEYS.recentLanguages, [{ code: 'en', ts: 1 }])
		migrateLangToAuto()
		expect(lang()).toBe('en')
	})

	it('the flag prevents a second run: an en stored afterwards is left alone', () => {
		writeConfig(CONFIG_KEYS.modelOptions, { lang: 'ru' })
		migrateLangToAuto()
		expect(lang()).toBe('ru')
		expect(readConfig(LANG_AUTO_MIGRATED_KEY, false)).toBe(true)
		writeConfig(CONFIG_KEYS.modelOptions, { lang: 'en' })
		migrateLangToAuto()
		expect(lang()).toBe('en')
	})

	it('a hand-edited recent languages value that is not an array does not throw and still switches', () => {
		writeConfig(CONFIG_KEYS.modelOptions, { lang: 'en' })
		writeConfig(CONFIG_KEYS.recentLanguages, { code: 'en' })
		expect(() => runMigrations()).not.toThrow()
		expect(lang()).toBe('auto')
		expect(readConfig(LANG_AUTO_MIGRATED_KEY, false)).toBe(true)
	})

	it('null entries in recent languages are skipped, a real en entry still counts', () => {
		writeConfig(CONFIG_KEYS.modelOptions, { lang: 'en' })
		writeConfig(CONFIG_KEYS.recentLanguages, [null, { code: 'en', ts: 1 }])
		expect(() => migrateLangToAuto()).not.toThrow()
		expect(lang()).toBe('en')
		expect(readConfig(LANG_AUTO_MIGRATED_KEY, false)).toBe(true)
	})

	it('entries without a code are ignored', () => {
		writeConfig(CONFIG_KEYS.modelOptions, { lang: 'en' })
		writeConfig(CONFIG_KEYS.recentLanguages, [{ ts: 1 }, 'en', 42])
		expect(() => migrateLangToAuto()).not.toThrow()
		expect(lang()).toBe('auto')
	})

	it('a broken stored options value never throws; the flag is still set', () => {
		writeConfig(CONFIG_KEYS.modelOptions, 'en')
		writeConfig(CONFIG_KEYS.recentLanguages, null)
		expect(() => migrateLangToAuto()).not.toThrow()
		expect(readConfig(LANG_AUTO_MIGRATED_KEY, false)).toBe(true)
	})

	it('runs as part of the startup migrations', () => {
		writeConfig(CONFIG_KEYS.modelOptions, { lang: 'en' })
		runMigrations()
		expect(lang()).toBe('auto')
	})
})
