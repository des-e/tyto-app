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
	tytoRecordingTooShort: 'Запись слишком короткая, сохранять нечего',
	tytoLowDiskStopped: 'Мало места на диске. Запись остановлена и сохранена',
	tytoRecordingPause: 'Пауза',
	tytoRecordingResume: 'Продолжить',
	tytoRecordingSaving: 'Сохраняю запись',
	tytoRecordingDeviceLost: 'Устройство звука отключилось. Запись остановлена и сохранена',
	tytoRecordingWriteFailed: 'Не удалось записать звук на диск. Запись остановлена и сохранена',
	tytoRecordingSaveFailed: 'Не удалось сохранить запись. Ее части остались в папке Записи',
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
	'tytoRecordingTooShort',
	'tytoLowDiskStopped',
	'tytoRecordingPause',
	'tytoRecordingResume',
	'tytoRecordingSaving',
	'tytoRecordingDeviceLost',
	'tytoRecordingWriteFailed',
	'tytoRecordingSaveFailed',
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
