import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Copy rules for every new key of the screen-recording plan; later tasks extend KEYS and RU.
const i18nDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../i18n/desktop')
const read = (locale: string): Record<string, string> => JSON.parse(readFileSync(resolve(i18nDir, `${locale}.json`), 'utf-8'))
const ru = read('ru-RU')
const en = read('en-US')

const RU: Record<string, string> = {
	tytoNotTranscribed: 'Не расшифровано',
	tytoMediaMissing: 'Файл не найден',
	tytoMediaPick: 'Указать файл',
	tytoDeleteRecordingFile: 'Удалить и файл записи?',
	tytoDeleteWithFile: 'Удалить с файлом',
	tytoKeepFile: 'Оставить файл',
	tytoCancel: 'Отмена',
	tytoDeleteProjectBody: 'Удалить «{name}»? Исходный файл останется на месте.',
}

const KEYS = [
	'tytoNotTranscribed',
	'tytoMediaMissing',
	'tytoMediaPick',
	'tytoDeleteRecordingFile',
	'tytoDeleteWithFile',
	'tytoKeepFile',
	'tytoCancel',
	'tytoDeleteProjectBody',
]

describe('тексты записи экрана', () => {
	it.each(KEYS)('%s: есть в ru и en, без «—», «ё», «терминал»', (key) => {
		expect(en[key]).toBeTypeOf('string')
		expect(ru[key]).toBeTypeOf('string')
		expect(ru[key]).not.toMatch(/—|ё|Ё|терминал/i)
	})

	it.each(Object.entries(RU))('%s по-русски: «%s»', (key, text) => {
		expect(ru[key]).toBe(text)
	})
})
