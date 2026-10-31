import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// The dialog's format list lives here (the dialog re-exports it); importing the dialog would pull in providers that need a window.
import { EXPORT_FORMATS as formats } from './export-format-grid'

const i18nDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../i18n/desktop')
const read = (locale: string): Record<string, string> => JSON.parse(readFileSync(resolve(i18nDir, `${locale}.json`), 'utf-8'))
const ru = read('ru-RU')
const en = read('en-US')

// Table "Тексты" of docs/design/2026-10-25-tyto-visual-language.md.
// exportDialogDescription is not pinned: the v2 dialog no longer shows it (the key stays in the locale files for upstream merges).
const COPY: Array<[string, string]> = [
	['setup', 'Первый запуск'],
	['downloadingModel', 'Готовим Tyto к работе'],
	['downloadingDiarizeModel', 'Скачиваем модель для разделения по говорящим…'],
	['downloading', 'Скачиваем… {progress}%'],
	['thisHappensOnce', 'Это нужно один раз. Дальше Tyto работает без интернета.'],
	['infoCancelDownload', 'Модель можно скачать позже в настройках или указать свой файл.'],
	['noConnection', 'Нет подключения к интернету'],
	['infoManualDownload', 'Модели скачиваются один раз, и для этого нужен интернет. Проверьте подключение и попробуйте еще раз.'],
	['tryAgain', 'Повторить'],
	['iPreferManualSetup', 'Указать файл модели вручную'],
	['dropFilesHere', 'Перетащите запись встречи'],
	['orClickToBrowse', 'Аудио или видео из Телемоста, Zoom, Битрикс24. Можно сразу несколько файлов или папку.'],
	['noRecentTranscripts', 'Здесь будут ваши расшифровки. Начните с записи встречи справа.'],
	['newTranscription', 'Новая расшифровка'],
	['newSession', 'Новая расшифровка'],
	['startRecord', 'Записать и расшифровать'],
	['transcribe', 'Расшифровать'],
	['transcribing', 'Расшифровываем…'],
	['transcribeTook', 'Готово за {total} с'],
	['segmentsTab', 'Текст'],
	['summaryTab', 'Сводка'],
	['summarizeLoading', 'Готовим сводку…'],
	['regenerateSummary', 'Пересоздать сводку'],
	['saveSuccess', 'Файл сохранен'],
	['copied', 'Скопировано'],
	['exportCopied', 'Текст скопирован'],
	['exportContent', 'Что сохранить'],
	['exportTranscript', 'Расшифровка'],
	['exportSummary', 'Сводка'],
	['exportContentTranscript', 'Расшифровку'],
	['exportContentSummary', 'Сводку'],
	['exportSave', 'Сохранить {format}'],
	// Export dialog v2 (section «Диалог экспорта»).
	['exportContentTranscriptDescription', 'Весь разговор с именами и временем'],
	['exportContentSummaryDescription', 'Главное: решения и задачи'],
	['exportSummaryUnavailable', 'Сначала создайте сводку'],
	['exportFormatGroupDocument', 'Документ'],
	['exportFormatGroupWeb', 'Субтитры и веб'],
	['exportAppearance', 'Оформление'],
	['exportDarkTheme', 'Темная тема документа'],
	['exportRtl', 'Текст справа налево'],
	['exportTimestampsRequired', 'нужно для субтитров'],
	['exportCancel', 'Отмена'],
	['exportFormatDocx', 'Word'],
	['exportFormatText', 'Простой текст'],
	['exportFormatHtml', 'Веб-страница'],
	['exportFormatSrt', 'Субтитры'],
	['exportFormatVtt', 'Веб-субтитры'],
	['exportFormatJson', 'Данные'],
	['exportCopy', 'Скопировать текст'],
	['showTimestamps', 'Время каждой реплики'],
	['showSpeakers', 'Имена говорящих'],
	['moreOptions', 'Еще настройки'],
	['languageauto', 'Определить автоматически'],
	// Settings navigation groups (item 11 of the spec).
	['settingsGroupTranscription', 'Расшифровка'],
	['settingsGroupRecording', 'Запись и голос'],
	['settingsGroupMore', 'Дополнительно'],
	['transcription', 'Распознавание'],
	['navAdvanced', 'Для опытных'],
	['modalErrorBody', 'Что-то пошло не так. Подробности ниже, их можно отправить нам.'],
	['resetApp', 'Сбросить настройки Tyto'],
	['crashedRecently', 'Tyto недавно закрылся с ошибкой, поэтому мы временно отключили видеокарту. Включить ее можно в настройках.'],
	['gpuFallbackToCpu', 'Не удалось запустить на видеокарте, расшифровываем на процессоре. Это медленнее.'],
	['updateAvailableOpenRecents', 'Доступно обновление: откройте недавние'],
	['hotkeyActivationPushToTalkDescription', 'Удерживайте сочетание клавиш для записи, отпустите для расшифровки.'],
	['updatingModalTitle', 'Обновляем Tyto'],
	['diarizeDownloadFailed', 'Не получилось скачать модель говорящих. Включить их можно позже в настройках.'],
	['closeToTray', 'Сворачивать в трей при закрытии'],
	['launchAtStartup', 'Запускать вместе с системой'],
	['preventSleep', 'Не давать компьютеру засыпать'],
	['generalHelp', 'Помощь'],
	['basedOnVibe', 'Tyto основан на открытом проекте Vibe (лицензия MIT). Спасибо автору.'],
	['generalTrayInfo', 'Tyto продолжит работать в фоне. Выйти можно из меню значка в трее.'],
	['launchAtStartupInfo', 'Tyto откроется сам, когда вы войдете в систему.'],
	['generalAwakeInfo', 'Пока Tyto открыт. Экран при этом может гаснуть, ноутбук быстрее разряжается.'],
	// «ИИ через прокси-сервис».
	['aiProxyPlatform', 'Через прокси-сервис'],
	['aiProxyHint', 'Вставьте адрес и ключ из инструкции вашего сервиса'],
	['aiApiAddress', 'Адрес API'],
	['aiProxyKey', 'Ключ'],
	['aiProxyFormat', 'Формат'],
	['aiProxyLabel', 'Прокси-сервис'],
	['aiProxyNoAddress', 'Укажите адрес API'],
	['aiProxyNoModel', 'Укажите модель'],
	['aiInsecureAddress', 'Адрес без https: ключ будет передаваться незашифрованным'],
]

describe('tyto ru copy', () => {
	it.each(COPY)('%s', (key, expected) => {
		expect(ru[key]).toBe(expected)
	})

	it('has every new key in en-US too', () => {
		for (const [key] of COPY) expect(en[key], key).toBeTypeOf('string')
	})

	it('keeps the {format} and {total} placeholders in both locales', () => {
		expect(en.exportSave).toContain('{format}')
		expect(en.transcribeTook).toContain('{total}')
	})

	it('has no emoji, exclamation marks or long dashes in any ru string', () => {
		for (const [key, value] of Object.entries(ru)) {
			expect(value, key).not.toMatch(/\p{Extended_Pictographic}/u)
			expect(value, key).not.toContain('!')
			expect(value, key).not.toContain(' — ')
		}
	})

	it('uses one word per concept: no транскрипция, транскрибировать, саммари, суммаризация', () => {
		for (const [key, value] of Object.entries(ru)) {
			expect(value.toLowerCase(), key).not.toMatch(/транскрип|транскриб|саммари|суммариз/)
		}
	})
})

describe('export save button label', () => {
	it('uses the display extension, not the internal format id', () => {
		const ext = (id: string) => formats.find((f) => f.value === id)?.extension
		expect(ext('normal')).toBe('TXT')
		expect(ext('md')).toBe('MD')
		expect(ru.exportSave.replace('{format}', ext('normal') ?? '')).toBe('Сохранить TXT')
	})
})
