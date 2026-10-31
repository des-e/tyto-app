// @vitest-environment jsdom

import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ serialize: vi.fn((..._args: unknown[]) => 'preview'), appTheme: 'light' as 'light' | 'dark' }))

vi.mock('@tauri-apps/api/path', () => ({ dirname: vi.fn(), downloadDir: vi.fn(), join: vi.fn() }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), writeTextFile: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('~/lib/app', () => ({ openPath: vi.fn() }))
vi.mock('~/lib/docx', () => ({ toDocx: vi.fn() }))
vi.mock('~/lib/pdf/transcript-pdf', () => ({ transcriptToPdf: vi.fn() }))
vi.mock('~/lib/transcript-export', () => ({ serializeTranscriptExport: h.serialize }))
vi.mock('~/providers/preference', () => ({
	usePreferenceProvider: () => ({ textAreaDirection: 'ltr', theme: h.appTheme, exportOptions: { theme: 'light' } }),
}))

import { setLocale } from '~/paraglide/runtime.js'
import type { TextFormat } from '~/components/format-select'
import TranscriptExportDialog, { type TranscriptExportDialogProps } from '~/pages/main/components/transcript-export-dialog'
import { useTranscriptExport } from '~/pages/main/hooks/use-transcript-export'

beforeAll(() => {
	setLocale('ru-RU', { reload: false })
})

afterEach(() => {
	cleanup()
	h.serialize.mockClear()
	h.appTheme = 'light'
})

function props(overrides: Partial<TranscriptExportDialogProps> = {}): TranscriptExportDialogProps {
	return {
		open: true,
		onOpenChange: vi.fn(),
		format: 'pdf',
		onFormatChange: vi.fn(),
		content: 'transcript',
		onContentChange: vi.fn(),
		hasSummary: true,
		showTimestamps: false,
		onShowTimestampsChange: vi.fn(),
		showSpeakers: true,
		onShowSpeakersChange: vi.fn(),
		preview: 'Анна: Коллеги, доброе утро.',
		direction: 'ltr',
		onDirectionChange: vi.fn(),
		theme: 'light',
		onThemeChange: vi.fn(),
		onCopy: vi.fn(),
		onSave: vi.fn(),
		title: 'Планерка отдела продаж',
		durationSeconds: 48 * 60,
		...overrides,
	}
}

const mount = (overrides: Partial<TranscriptExportDialogProps> = {}) => render(<TranscriptExportDialog {...props(overrides)} />)

const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(name) }) as HTMLInputElement
const checkbox = (name: string) => screen.getByRole('checkbox', { name: new RegExp(name) }) as HTMLInputElement

describe('export dialog v2: layout', () => {
	it('options and preview sit side by side from 768px, so the 800px default window gets two columns', () => {
		mount()
		const preview = screen.getByRole('region', { name: 'Предпросмотр' })
		const grid = preview.parentElement as HTMLElement
		expect(grid.className).toContain('md:grid-cols-[420px_minmax(0,1fr)]')
		expect(grid.className).not.toMatch(/\blg:/)
	})
})

describe('export dialog v2: formats', () => {
	it('has no CSV option', () => {
		mount()
		expect(screen.queryByText('CSV')).toBeNull()
		expect(screen.queryAllByRole('radio', { name: /CSV/ })).toHaveLength(0)
		expect(screen.getAllByRole('radio', { name: /PDF|DOCX|TXT|MD|HTML|SRT|VTT|JSON/ })).toHaveLength(8)
	})

	it('shows two groups of four formats, in the order of the design doc', () => {
		mount()
		const documentGroup = screen.getByRole('group', { name: 'Документ' })
		const webGroup = screen.getByRole('group', { name: 'Субтитры и веб' })
		const names = (group: HTMLElement) => within(group).getAllByRole('radio').map((r) => r.closest('label')?.textContent)
		expect(names(documentGroup)).toEqual(['PDFPDF', 'WordDOCX', 'Простой текстTXT', 'MarkdownMD'])
		expect(names(webGroup)).toEqual(['Веб-страницаHTML', 'СубтитрыSRT', 'Веб-субтитрыVTT', 'ДанныеJSON'])
	})

	it('both columns sit in one grid of a 24px header row and four 32px rows', () => {
		mount()
		const documentGroup = screen.getByRole('group', { name: 'Документ' })
		const grid = documentGroup.parentElement as HTMLElement
		expect(grid.className).toContain('grid-cols-2')
		expect(grid.className).toContain('grid-rows-[24px_repeat(4,32px)]')
		expect(documentGroup.className).toContain('grid-rows-subgrid')
		for (const row of within(documentGroup).getAllByRole('radio')) expect(row.closest('label')?.className).toContain('h-8')
	})

	it('selecting a format reports it', () => {
		const onFormatChange = vi.fn()
		mount({ onFormatChange })
		fireEvent.click(radio('Субтитры'))
		expect(onFormatChange).toHaveBeenCalledWith('srt')
		expect(radio('PDF').checked).toBe(true)
	})

	it('describes the selected format under the list', () => {
		mount({ format: 'pdf' })
		expect(screen.getByText('Документ для печати.')).toBeTruthy()
	})
})

describe('export dialog v2: what to save', () => {
	it('shows two cards with descriptions', () => {
		mount()
		const transcript = radio('Расшифровку')
		const summary = radio('Сводку')
		expect(transcript.closest('label')?.textContent).toContain('Весь разговор с именами и временем')
		expect(summary.closest('label')?.textContent).toContain('Главное: решения и задачи')
		expect(transcript.checked).toBe(true)
		expect(summary.disabled).toBe(false)
	})

	it('without a summary the summary card is disabled and says why', () => {
		mount({ hasSummary: false })
		const summary = radio('Сводку')
		expect(summary.disabled).toBe(true)
		expect(summary.closest('label')?.textContent).toContain('Сначала создайте сводку')
		expect(summary.closest('label')?.textContent).not.toContain('Главное: решения и задачи')
	})

	it('choosing the summary card reports it', () => {
		const onContentChange = vi.fn()
		mount({ onContentChange })
		fireEvent.click(radio('Сводку'))
		expect(onContentChange).toHaveBeenCalledWith('summary')
	})

	it('cards are outlined, not filled: transparent, ink text, selected = ink border', () => {
		mount()
		const selected = radio('Расшифровку').closest('label') as HTMLElement
		const other = radio('Сводку').closest('label') as HTMLElement
		for (const card of [selected, other]) {
			expect(card.className).toContain('bg-transparent')
			expect(card.className).toContain('text-foreground')
			expect(card.className).not.toContain('tyto-selected')
			// The theme paints [role=radiogroup] [role=radio][aria-checked=true] as a solid plate; the cards must stay out of it.
			expect(card.closest('[role="radiogroup"]')).toBeNull()
			expect(card.querySelector('[role="radio"]')).toBeNull()
		}
		expect(selected.className).toContain('border-foreground')
		expect(other.className).not.toContain('border-foreground')
	})
})

describe('export dialog v2: appearance', () => {
	it.each<TextFormat>(['srt', 'vtt'])('for %s the timestamps box is checked, locked and says why', (format) => {
		mount({ format, showTimestamps: false })
		const box = checkbox('Время каждой реплики')
		expect(box.checked).toBe(true)
		expect(box.disabled).toBe(true)
		expect(box.closest('label')?.textContent).toContain('нужно для субтитров')
	})

	it('for other formats the timestamps box follows the setting', () => {
		const onShowTimestampsChange = vi.fn()
		mount({ format: 'normal', showTimestamps: false, onShowTimestampsChange })
		const box = checkbox('Время каждой реплики')
		expect(box.checked).toBe(false)
		expect(box.disabled).toBe(false)
		fireEvent.click(box)
		expect(onShowTimestampsChange).toHaveBeenCalledWith(true)
	})

	it.each<[TextFormat, boolean]>([
		['pdf', true],
		['html', true],
		['docx', true],
		['normal', false],
		['md', false],
		['srt', false],
		['vtt', false],
		['json', false],
	])('dark document theme for %s is shown: %s', (format, shown) => {
		mount({ format })
		expect(screen.queryByRole('checkbox', { name: /Темная тема документа/ }) !== null).toBe(shown)
	})

	it('dark theme and right-to-left are checkboxes over the same props', () => {
		const onThemeChange = vi.fn()
		const onDirectionChange = vi.fn()
		const onShowSpeakersChange = vi.fn()
		mount({ format: 'pdf', onThemeChange, onDirectionChange, onShowSpeakersChange })
		fireEvent.click(checkbox('Темная тема документа'))
		expect(onThemeChange).toHaveBeenCalledWith('dark')
		fireEvent.click(checkbox('Текст справа налево'))
		expect(onDirectionChange).toHaveBeenCalledWith('rtl')
		fireEvent.click(checkbox('Имена говорящих'))
		expect(onShowSpeakersChange).toHaveBeenCalledWith(false)
	})

	it('all appearance rows share one 32px grid in a fixed order', () => {
		mount({ format: 'pdf' })
		const rows = screen.getAllByRole('checkbox').map((box) => box.closest('label') as HTMLElement)
		expect(rows.map((row) => row.textContent)).toEqual(['Имена говорящих', 'Время каждой реплики', 'Темная тема документа', 'Текст справа налево'])
		expect(rows[0].parentElement?.className).toContain('auto-rows-[32px]')
		for (const row of rows) expect(row.className).toContain('grid-cols-[16px_1fr]')
	})
})

describe('export dialog v2: header and footer', () => {
	it('header names the recording and its length instead of the old description', () => {
		mount()
		expect(screen.getByText('Планерка отдела продаж · 48 мин')).toBeTruthy()
		expect(screen.queryByText('Выберите, что экспортировать и как это использовать.')).toBeNull()
	})

	it.each<[TextFormat, string]>([
		['pdf', 'Сохранить PDF'],
		['normal', 'Сохранить TXT'],
		['docx', 'Сохранить DOCX'],
		['srt', 'Сохранить SRT'],
	])('main button for %s reads «%s»', (format, label) => {
		const onSave = vi.fn()
		mount({ format, onSave })
		const button = screen.getByRole('button', { name: label })
		expect(button.className).toContain('tyto-btn-primary')
		fireEvent.click(button)
		expect(onSave).toHaveBeenCalled()
	})

	it('footer: ghost cancel, secondary copy for text formats only', () => {
		const onOpenChange = vi.fn()
		const { unmount } = mount({ format: 'srt', onOpenChange })
		expect(screen.getByRole('button', { name: 'Скопировать текст' }).className).toContain('tyto-btn-secondary')
		const cancel = screen.getByRole('button', { name: 'Отмена' })
		expect(cancel.className).toContain('tyto-btn-ghost')
		fireEvent.click(cancel)
		expect(onOpenChange).toHaveBeenCalledWith(false)
		unmount()
		mount({ format: 'pdf' })
		expect(screen.queryByRole('button', { name: 'Скопировать текст' })).toBeNull()
	})

	it('footer shows the future file name, truncated with the full name as a title', () => {
		const long = 'Очень длинное название планерки отдела продаж за четвертый квартал с итогами и планами на следующий год'
		mount({ format: 'pdf', title: long })
		const name = screen.getByTestId('tyto-export-filename')
		expect(name.textContent).toBe(`${long}.pdf`)
		expect(name.getAttribute('title')).toBe(`${long}.pdf`)
		// Only the stem shortens; the extension stays on screen.
		expect(screen.getByText(long).className).toContain('truncate')
		const extension = screen.getByText('.pdf')
		expect(extension.className).not.toContain('truncate')
		expect(extension.className).toContain('shrink-0')
	})

	it('footer file name follows the format', () => {
		mount({ format: 'normal' })
		expect(screen.getByTestId('tyto-export-filename').textContent).toBe('Планерка отдела продаж.txt')
	})
})

/** WCAG 2 contrast of two #rrggbb colours. */
function contrast(a: string, b: string) {
	const luminance = (hex: string) => {
		const [r, g, bl] = [1, 3, 5].map((i) => {
			const v = parseInt(hex.slice(i, i + 2), 16) / 255
			return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
		})
		return 0.2126 * r + 0.7152 * g + 0.0722 * bl
	}
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return (hi + 0.05) / (lo + 0.05)
}

function tokens(css: string, selector: string): Record<string, string> {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
	if (!match) throw new Error(`no ${selector} block`)
	return Object.fromEntries([...match[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim().toLowerCase()]))
}

describe('export dialog v2: JSON preview colours', () => {
	const JSON_PREVIEW = ['{', '  "a": 1', '}'].join('\n')
	// jsdom lays nothing out, so the virtualized preview would render no rows: give elements a size.
	beforeEach(() => {
		vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400)
		vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})
	// oneDark / oneLight base text colours of the prism styles.
	const codeColour = () => {
		const code = document.querySelector('[aria-label="Предпросмотр экспорта"] pre') as HTMLElement | null
		expect(code).not.toBeNull()
		return code?.style.color
	}

	it('dark app + light document theme: JSON is drawn with the dark highlighter', () => {
		h.appTheme = 'dark'
		mount({ format: 'json', theme: 'light', preview: JSON_PREVIEW })
		expect(codeColour()).toBe('rgb(171, 178, 191)')
	})

	it('light app + dark document theme: JSON is drawn with the light highlighter', () => {
		h.appTheme = 'light'
		mount({ format: 'json', theme: 'dark', preview: JSON_PREVIEW })
		expect(codeColour()).toBe('rgb(56, 58, 66)')
	})
})

describe('export dialog v2: contrast of the cards', () => {
	const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'theme.css'), 'utf-8')

	it('card text tokens keep >= 4.5:1 on the dialog surface in both themes, selected and disabled included', () => {
		mount({ hasSummary: false })
		const dialog = screen.getByRole('dialog')
		// The dialog surface is the page background; the cards are transparent over it.
		expect(dialog.className).toContain('bg-background')
		const disabledCard = radio('Сводку').closest('label') as HTMLElement
		expect(disabledCard.className).toContain('text-[var(--tyto-disabled-fg)]')
		expect(disabledCard.className).not.toMatch(/opacity-/)
		const description = within(radio('Расшифровку').closest('label') as HTMLElement).getByText('Весь разговор с именами и временем')
		expect(description.className).toContain('text-muted-foreground')

		for (const theme of [tokens(css, ':root'), tokens(css, '.dark')]) {
			expect(contrast(theme.foreground, theme.background)).toBeGreaterThanOrEqual(4.5)
			expect(contrast(theme['muted-foreground'], theme.background)).toBeGreaterThanOrEqual(4.5)
			expect(contrast(theme['tyto-disabled-fg'], theme.background)).toBeGreaterThanOrEqual(4.5)
		}
	})
})

describe('use-transcript-export: subtitles always carry timestamps', () => {
	it.each<TextFormat>(['srt', 'vtt'])('%s exports with showTimestamps: true even when the box was off', (format) => {
		renderHook(() =>
			useTranscriptExport({
				segments: [{ start: 0, stop: 100, text: 'Привет' }],
				file: { name: 'Планерка', path: '/tmp/a.wav' },
				format,
				content: 'transcript',
				showTimestamps: false,
				showSpeakers: true,
			}),
		)
		const options = h.serialize.mock.calls.map((call) => call[3] as { showTimestamps: boolean })
		expect(options.length).toBeGreaterThan(0)
		for (const option of options) expect(option.showTimestamps).toBe(true)
	})

	it('other formats keep the choice', () => {
		renderHook(() =>
			useTranscriptExport({
				segments: [{ start: 0, stop: 100, text: 'Привет' }],
				file: { name: 'Планерка', path: '/tmp/a.wav' },
				format: 'normal',
				content: 'transcript',
				showTimestamps: false,
				showSpeakers: true,
			}),
		)
		expect((h.serialize.mock.calls[0][3] as { showTimestamps: boolean }).showTimestamps).toBe(false)
	})
})
