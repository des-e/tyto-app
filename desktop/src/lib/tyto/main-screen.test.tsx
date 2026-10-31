// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
	listeners: new Map<string, (event: { payload: unknown }) => void>(),
	queue: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
		h.listeners.set(name, handler)
		return () => {}
	}),
	emit: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-store', () => ({
	load: async () => ({ entries: async () => [], onChange: async () => () => {}, get: async () => null, set: async () => {}, delete: async () => {} }),
}))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('~/providers/preference', () => ({ usePreferenceProvider: () => ({ textAreaDirection: 'ltr', modelPath: '/m.bin' }) }))
vi.mock('~/pages/main/session', () => ({ useSession: () => ({ queue: h.queue }) }))
vi.mock('~/pages/main/components/player-bar', () => ({
	PLAYER_SEEK_EVENT: 'vibe:player-seek',
	PLAYER_TIME_EVENT: 'vibe:player-time',
	PLAYER_TOGGLE_EVENT: 'vibe:player-toggle',
}))
vi.mock('~/pages/main/components/quiet-row', () => ({ default: () => null }))
vi.mock('~/pages/main/components/summary-view', () => ({ default: () => <div data-testid="summary-view" /> }))
// jsdom has no layout: the virtualizer would render nothing, so it hands every row over.
vi.mock('@tanstack/react-virtual', () => ({
	defaultRangeExtractor: () => [],
	useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey: (index: number) => string | number }) => ({
		getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: 0 })),
		getTotalSize: () => 0,
		measureElement: () => {},
		scrollToIndex: () => {},
		options: { scrollMargin: 0 },
	}),
}))

import { setLocale } from '~/paraglide/runtime.js'
import type { Segment } from '~/lib/transcript'
import TranscriptView from '~/pages/main/components/transcript-view'
import { SpeakerLabel } from '~/pages/main/components/speaker-label'
import { useDropTarget } from '~/pages/main/hooks/use-drop-target'
import { EmptyScreen } from './empty-screen'
import { SpeakerMark } from './speaker-mark'
import { TranscriptTabs } from './transcript-tabs'

beforeAll(() => {
	setLocale('ru-RU', { reload: false })
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver
})

beforeEach(() => {
	h.listeners.clear()
	h.queue = {
		updateSegmentText: vi.fn(),
		setSpeakerName: vi.fn(),
		setSegmentSpeaker: vi.fn(),
		previewJobName: vi.fn(),
		renameJob: vi.fn(async () => true),
		transcribeJob: vi.fn(),
	}
})

afterEach(cleanup)

const options = {
	textSize: 'md' as const,
	setTextSize: vi.fn(),
	showTimestamps: true,
	setShowTimestamps: vi.fn(),
	showSpeakers: true,
	setShowSpeakers: vi.fn(),
}

const segments: Segment[] = [
	{ start: 0, stop: 2400, text: 'Коллеги, доброе утро.', speaker: 0 },
	{ start: 2400, stop: 5100, text: 'Сегодня три вопроса: план на ноябрь.', speaker: 0 },
	{ start: 5100, stop: 9200, text: 'Октябрь закрыли на 92 процента.', speaker: 1 },
	{ start: 9200, stop: 10000, text: 'Давайте посмотрим, что можно дожать.', speaker: 0 },
]

function renderTranscript(query = '') {
	const job = { id: 'j1', name: 'Планерка отдела продаж', status: 'done', segments, speakerNames: { 0: 'Анна', 1: 'Игорь' }, hydrated: true }
	return render(<TranscriptView job={job as never} query={query} options={options} />)
}

const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-segment-index]')]

describe('расшифровка как сценарий', () => {
	it('имя говорящего выводится один раз на серию', () => {
		const { container } = renderTranscript()
		const lines = rows(container)
		expect(lines.map((row) => row.getAttribute('data-series-start'))).toEqual(['true', 'false', 'true', 'true'])
		const headers = [...container.querySelectorAll('.tyto-script-who')].map((node) => node.textContent?.trim())
		expect(headers).toEqual(['ААнна', 'ИИгорь', 'ААнна'])
		// Lines inside a series carry no visible name: only a hover chip to move that one line.
		expect(lines[1].querySelector('.tyto-script-who')).toBeNull()
	})

	it('время на поле слева: кнопка «Воспроизвести с 01:32», клик переводит плеер', () => {
		renderTranscript()
		const seek = vi.fn()
		window.addEventListener('vibe:player-seek', seek)
		const button = screen.getByRole('button', { name: 'Воспроизвести с 01:32' })
		expect(button.textContent).toContain('01:32')
		fireEvent.click(button)
		window.removeEventListener('vibe:player-seek', seek)
		expect(seek).toHaveBeenCalledTimes(1)
		expect((seek.mock.calls[0][0] as CustomEvent).detail).toEqual({ seconds: 92 })
	})

	it('текущая фраза помечается во время воспроизведения', () => {
		const { container } = renderTranscript()
		act(() => {
			window.dispatchEvent(new CustomEvent('vibe:player-time', { detail: { seconds: 52, playing: true } }))
		})
		expect(rows(container).map((row) => row.getAttribute('data-active'))).toEqual(['false', 'false', 'true', 'false'])
	})

	it('правка текста по клику по-прежнему открывает редактор', () => {
		renderTranscript()
		fireEvent.click(screen.getByText('Октябрь закрыли на 92 процента.'))
		const editor = screen.getByRole('textbox', { name: 'Изменить строку' }) as HTMLTextAreaElement
		expect(editor.tagName).toBe('TEXTAREA')
		expect(editor.value).toBe('Октябрь закрыли на 92 процента.')
	})

	it('правка текста с клавиатуры: Enter на строке открывает редактор', () => {
		renderTranscript()
		const line = screen.getByText('Давайте посмотрим, что можно дожать.').closest('[role="textbox"]')!
		fireEvent.keyDown(line, { key: 'Enter' })
		expect((screen.getByRole('textbox', { name: 'Изменить строку' }) as HTMLTextAreaElement).value).toBe('Давайте посмотрим, что можно дожать.')
	})

	it('строку внутри серии можно перенести к другому говорящему', () => {
		const { container } = renderTranscript()
		const second = rows(container)[1]
		const chip = second.querySelector<HTMLButtonElement>('.tyto-script-aside button')!
		expect(chip.textContent).toBe('ААнна')
		fireEvent.click(chip)
		const igor = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((button) => button.textContent === 'Игорь')!
		fireEvent.click(igor)
		expect(h.queue.setSegmentSpeaker).toHaveBeenCalledWith('j1', 1, 1)
	})

	it('заголовок документа 26/600 и текст встречи 15/1.65 (строка 3)', () => {
		const { container } = renderTranscript()
		expect(screen.getByRole('button', { name: 'Планерка отдела продаж' }).className).toContain('tyto-title-doc')
		const line = container.querySelector('[role="textbox"]')!
		expect(line.className).toContain('tyto-text-meeting')
		expect(line.className).toContain('leading-[1.65]')
		fireEvent.click(line)
		expect(screen.getByRole('textbox', { name: 'Изменить строку' }).className).toContain('tyto-text-meeting')
	})

	it('поиск подсвечивает совпадения', () => {
		const { container } = renderTranscript('план')
		expect(rows(container)).toHaveLength(1)
		expect(container.querySelector('mark')?.textContent).toBe('план')
	})
})

describe('метка говорящего', () => {
	const mark = (speaker: number, name?: string) => {
		const { container } = render(<SpeakerMark speaker={speaker} name={name} />)
		return container.querySelector<HTMLElement>('.tyto-speaker-mark')!
	}

	it('квадрат с первой буквой: залитая, контурная, серая, дальше повтор с цифрой', () => {
		expect([mark(0, 'Анна'), mark(1, 'игорь'), mark(2, 'Мария')].map((node) => [node.dataset.tone, node.textContent])).toEqual([
			['filled', 'А'],
			['outline', 'И'],
			['grey', 'М'],
		])
		const fourth = mark(3, 'Олег')
		expect(fourth.dataset.tone).toBe('filled')
		expect(fourth.textContent).toBe('О2')
		expect(mark(6, 'Вера').textContent).toBe('В3')
	})

	it('без выбранного имени метка показывает номер говорящего', () => {
		expect([mark(0), mark(1), mark(2), mark(3), mark(9, '  ')].map((node) => [node.dataset.tone, node.textContent])).toEqual([
			['filled', '1'],
			['outline', '2'],
			['grey', '3'],
			['filled', '4'],
			['filled', '10'],
		])
	})

	it('в расшифровке неназванный говорящий получает номер, названный букву', () => {
		const job = { id: 'j2', name: 'x', status: 'done', hydrated: true, speakerNames: { 0: 'Анна' }, segments: [segments[0], segments[2]] }
		const { container } = render(<TranscriptView job={job as never} query="" options={options} />)
		expect([...container.querySelectorAll('.tyto-speaker-mark')].map((node) => node.textContent)).toEqual(['А', '2'])
	})

	it('метка декоративная: имя читается рядом', () => {
		expect(mark(0, 'Анна').getAttribute('aria-hidden')).toBe('true')
	})
})

describe('вкладки «Текст / Сводка / Темы»', () => {
	it('три вкладки, «Темы» видна и неактивна', () => {
		const setTab = vi.fn()
		render(<TranscriptTabs tab="transcript" setTab={setTab} summaryReady />)
		const tabs = within(screen.getByRole('tablist')).getAllByRole('tab')
		expect(tabs.map((tab) => tab.textContent)).toEqual(['Текст', 'Сводка', 'Темы'])
		expect(tabs[0].getAttribute('aria-selected')).toBe('true')
		expect((tabs[2] as HTMLButtonElement).disabled).toBe(true)
		const hint = document.getElementById(tabs[2].getAttribute('aria-describedby')!)
		expect(hint?.textContent).toBe('Темы с таймкодами появятся позже')
		fireEvent.click(tabs[2])
		fireEvent.click(tabs[1])
		expect(setTab.mock.calls).toEqual([['summary']])
	})

	it('без сводки вкладка «Сводка» неактивна', () => {
		render(<TranscriptTabs tab="transcript" setTab={vi.fn()} summaryReady={false} />)
		expect((screen.getByRole('tab', { name: 'Сводка' }) as HTMLButtonElement).disabled).toBe(true)
	})
})

describe('пустой экран', () => {
	const props = () => ({
		dragging: false,
		collectingFolder: false,
		panel: 'none' as const,
		onBrowse: vi.fn(),
		onSelectPanel: vi.fn(),
		options: null,
	})

	it('три подписанные кнопки и строка «Файлы не покидают компьютер»', () => {
		const p = props()
		render(<EmptyScreen {...p} />)
		expect(screen.getByRole('heading', { name: 'Перетащите запись встречи' })).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Выбрать файл' }))
		fireEvent.click(screen.getByRole('button', { name: 'Записать' }))
		fireEvent.click(screen.getByRole('button', { name: 'По ссылке' }))
		expect(p.onBrowse).toHaveBeenCalledTimes(1)
		expect(p.onSelectPanel.mock.calls).toEqual([['record'], ['link']])
		expect(screen.getByText('Файлы не покидают компьютер')).toBeTruthy()
		expect(screen.getByText('Язык встречи:')).toBeTruthy()
	})

	it('повторное нажатие активного источника возвращает к файлу', () => {
		const p = { ...props(), panel: 'record' as const }
		render(<EmptyScreen {...p} panelContent={<p>панель записи</p>} />)
		expect(screen.getByRole('button', { name: 'Записать' }).getAttribute('aria-pressed')).toBe('true')
		expect(screen.getByText('панель записи')).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Записать' }))
		expect(p.onSelectPanel).toHaveBeenCalledWith('none')
	})

	it('drop работает на всей правой области: перетаскивание подсвечивает ее, сброс уходит в обработчик upstream', async () => {
		const onPaths = vi.fn()
		function Harness() {
			const dragging = useDropTarget(onPaths)
			return <EmptyScreen {...props()} dragging={dragging} />
		}
		render(<Harness />)
		const area = screen.getByTestId('empty-screen')
		expect(area.getAttribute('data-dragging')).toBe('false')

		act(() => {
			area.dispatchEvent(new Event('dragenter', { bubbles: true, cancelable: true }))
		})
		expect(area.getAttribute('data-dragging')).toBe('true')

		await vi.waitFor(() => expect(h.listeners.has('tauri://drag-drop')).toBe(true))
		act(() => h.listeners.get('tauri://drag-drop')!({ payload: { paths: ['C:/встреча.mp3'] } }))
		expect(onPaths).toHaveBeenCalledWith(['C:/встреча.mp3'])
		expect(area.getAttribute('data-dragging')).toBe('false')
	})
})

describe('long speaker names', () => {
	const longName = 'Константин Константинопольский-Преображенский, руководитель'.padEnd(60, 'а')

	it.each([false, true])('truncate on one line and keep the full name in the tooltip (editable: %s)', (editable) => {
		render(<SpeakerLabel speaker={0} speakers={[0]} speakerNames={{ 0: longName }} editable={editable} onRename={vi.fn()} onAssign={vi.fn()} />)
		const name = screen.getByText(longName)
		expect(longName).toHaveLength(60)
		expect(name.className).toContain('truncate')
		expect(name.getAttribute('title')).toBe(longName)
	})

	it('the name box may shrink, and the hover chip never covers more than 40% of the line', () => {
		const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'theme.css'), 'utf-8')
		const who = css.match(/\n\.tyto-who\s*\{([^}]*)\}/)?.[1] ?? ''
		expect(who).toMatch(/max-width: 100%/)
		expect(who).toMatch(/min-width: 0/)
		const aside = css.match(/\n\.tyto-script-aside\s*\{([^}]*)\}/)?.[1] ?? ''
		expect(aside).toMatch(/max-width: 40%/)
	})
})
