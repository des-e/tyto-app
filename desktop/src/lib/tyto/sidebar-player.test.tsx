// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null), convertFileSrc: (path: string) => `asset://${path}` }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({}))
vi.mock('@tauri-apps/plugin-dialog', () => ({}))
vi.mock('@tauri-apps/plugin-fs', () => ({}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('~/lib/app', () => ({ openSettingsSection: vi.fn() }))
vi.mock('~/lib/logs', () => ({ getVersionNumber: vi.fn(async () => '0.1.0') }))
// The row's re-transcribe dialog needs the preference provider; it is not under test here.
vi.mock('~/pages/main/components/retranscribe-dialog', () => ({ default: () => null }))
vi.mock('~/lib/playback-rate', () => ({ usePlaybackRate: () => ({ playbackRate: 1, cyclePlaybackRate: vi.fn() }) }))

const LONG_NAME = 'Очень длинное название встречи с подрядчиком про сроки поставки и монтажа оборудования'

const store = vi.hoisted(() => ({
	entries: [] as { path: string; name: string; createdAt: Date }[],
	durations: {} as Record<string, number>,
}))

vi.mock('~/lib/transcripts-store', () => ({
	listTranscripts: vi.fn(async () => store.entries),
	readTranscript: vi.fn(async (path: string) => {
		const stop = store.durations[path]
		return stop === undefined ? null : { name: 'x', sourcePath: '', createdAt: '', segments: [{ start: 0, stop: stop * 100, text: 't' }] }
	}),
	TRANSCRIPTS_CHANGED_EVENT: 'transcripts-changed',
}))

const session = vi.hoisted(() => ({
	value: {
		queue: { jobs: [] as unknown[], selectedJob: null as unknown, selectedId: null as string | null, running: false, selectJob: () => {}, hydrate: () => {} },
		startNew: () => {},
		preference: { projectsPath: '' },
	},
}))
vi.mock('~/pages/main/session', () => ({ useSession: () => session.value }))

import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { TooltipProvider } from '~/components/ui/tooltip'
import type { Segment } from '~/lib/transcript'
import PlayerBar from '~/pages/main/components/player-bar'
import RecentsSidebar from '~/pages/main/components/recents-sidebar'
import { setLocale } from '~/paraglide/runtime.js'
import { ReplicaTimeline } from './replica-timeline'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'theme.css'), 'utf-8')

const today = (hours: number, minutes: number) => {
	const date = new Date()
	date.setHours(hours, minutes, 0, 0)
	return date
}
const yesterday = (hours: number, minutes: number) => {
	const date = today(hours, minutes)
	date.setDate(date.getDate() - 1)
	return date
}

beforeAll(() => {
	setLocale('ru-RU', { reload: false })
	// jsdom has no layout; the virtualized list needs a viewport to mount its rows.
	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 800 })
	Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 248 })
})

beforeEach(() => {
	store.entries = [
		{ path: '/p/plan/transcript.vibe.json', name: 'Планерка отдела продаж', createdAt: today(10, 2) },
		{ path: '/p/long/transcript.vibe.json', name: LONG_NAME, createdAt: today(9, 15) },
		{ path: '/p/log/transcript.vibe.json', name: 'Интервью: логист на склад', createdAt: yesterday(17, 40) },
	]
	store.durations = { '/p/plan/transcript.vibe.json': 48 * 60, '/p/long/transcript.vibe.json': 22 * 60 }
	const running = { id: 'run', name: 'Созвон с бухгалтерией', path: '/m/a.mp3', status: 'running', progress: 64, segments: [] }
	const selected = { id: 'sel', name: 'Планерка отдела продаж', path: '/m/b.mp3', status: 'done', progress: 100, segments: [], savedPath: '/p/plan/transcript.vibe.json', hydrated: true }
	session.value.queue = { ...session.value.queue, jobs: [running, selected], selectedJob: selected, selectedId: 'sel', running: false }
	vi.clearAllMocks()
})

afterEach(cleanup)

function renderSidebar() {
	return render(
		<TooltipProvider>
			<RecentsSidebar />
		</TooltipProvider>,
	)
}

function rowOf(text: string) {
	const row = screen.getByText(text).closest('.tyto-recent')
	if (!row) throw new Error(`no row for ${text}`)
	return row as HTMLElement
}

describe('боковая панель (отличие 5)', () => {
	it('записи разложены по группам «Сегодня / Вчера», идущая расшифровка в «Сегодня»', async () => {
		renderSidebar()
		await screen.findByText('Планерка отдела продаж')
		const labels = [...document.querySelectorAll('.tyto-group-label')].map((label) => label.textContent)
		expect(labels).toEqual(['Сегодня', 'Вчера'])
		const order = [...document.querySelectorAll('.tyto-group-label, .tyto-recent-title')].map((node) => node.textContent)
		expect(order).toEqual(['Сегодня', 'Созвон с бухгалтерией', 'Планерка отдела продаж', LONG_NAME, 'Вчера', 'Интервью: логист на склад'])
	})

	it('под названием мета «10:02 · 48 мин»', async () => {
		renderSidebar()
		expect(await screen.findByText('10:02 · 48 мин')).toBeTruthy()
		// Without a readable record the row still shows its time.
		expect(within(rowOf('Интервью: логист на склад')).getByText('17:40')).toBeTruthy()
	})

	it('выбранная запись отмечена чертой слева, а не черной плашкой', async () => {
		renderSidebar()
		await screen.findByText('Планерка отдела продаж')
		const selected = rowOf('Планерка отдела продаж')
		expect(selected.classList.contains('tyto-recent-selected')).toBe(true)
		expect(selected.classList.contains('tyto-selected')).toBe(false)
		expect(rowOf('Интервью: логист на склад').classList.contains('tyto-recent-selected')).toBe(false)
		expect(css).toMatch(/\.tyto-recent-selected::before\s*\{[^}]*width: 2px[^}]*background: var\(--foreground\)/)
		expect(css).toMatch(/\.tyto-recent-selected[^{]*\{[^}]*background(?:-color)?: var\(--background\)/)
	})

	it('идущая расшифровка показывает мини-полосу прогресса', async () => {
		renderSidebar()
		const row = rowOf('Созвон с бухгалтерией')
		const bar = within(row).getByRole('progressbar')
		expect(bar.getAttribute('aria-valuenow')).toBe('64')
		expect(within(row).getByText('Расшифровываем · 64%')).toBeTruthy()
	})

	it('длинное название обрезается многоточием, полное видно в подсказке', async () => {
		renderSidebar()
		const title = await screen.findByText(LONG_NAME)
		expect(title.className).toContain('truncate')
		expect(title.closest('[title]')?.getAttribute('title')).toBe(LONG_NAME)
	})

	it('поиск сверху фильтрует по названию', async () => {
		renderSidebar()
		await screen.findByText('Планерка отдела продаж')
		fireEvent.change(screen.getByPlaceholderText('Поиск'), { target: { value: 'логист' } })
		expect(screen.queryByText('Планерка отдела продаж')).toBeNull()
		expect(screen.queryByText('Созвон с бухгалтерией')).toBeNull()
		expect(screen.getByText('Интервью: логист на склад')).toBeTruthy()
	})

	it('внизу «Настройки» и версия', async () => {
		renderSidebar()
		expect(await screen.findByText('0.1.0')).toBeTruthy()
		const footer = screen.getByText('Настройки').closest('.tyto-bar')
		expect(footer).toBeTruthy()
		expect(footer?.contains(screen.getByText('0.1.0'))).toBe(true)
	})
})

const segments: Segment[] = [
	{ start: 0, stop: 2400, text: 'a', speaker: 0 },
	{ start: 2400, stop: 5100, text: 'b', speaker: 0 },
	{ start: 5100, stop: 7800, text: 'c', speaker: 1 },
	{ start: 7800, stop: 9000, text: 'd', speaker: 2 },
	{ start: 9000, stop: 12000, text: 'e', speaker: 0 },
]

describe('плеер со шкалой реплик (отличие 8)', () => {
	it('шкала из отрезков реплик: одна реплика на серию говорящего, оттенок по говорящему', () => {
		render(<ReplicaTimeline segments={segments} duration={120} currentTime={30} seekable onSeek={vi.fn()} onToggle={vi.fn()} />)
		const replicas = document.querySelectorAll('[data-replica-start]')
		expect([...replicas].map((node) => node.getAttribute('data-replica-start'))).toEqual(['0', '51', '78', '90'])
		const tones = [...document.querySelectorAll('.tyto-timeline-played .tyto-timeline-replica')].map((node) => node.getAttribute('data-tone'))
		expect(tones).toEqual(['filled', 'outline', 'grey', 'filled'])
	})

	it('оттенки говорящих видны и на неотыгранной части (позиция 0)', () => {
		render(<ReplicaTimeline segments={segments} duration={120} currentTime={0} seekable onSeek={vi.fn()} onToggle={vi.fn()} />)
		const tones = [...document.querySelectorAll('[data-replica-start]')].map((node) => node.getAttribute('data-tone'))
		expect(tones).toEqual(['filled', 'outline', 'grey', 'filled'])
		const unplayed = (tone: string) => {
			const match = css.match(new RegExp(`\\n\\.tyto-timeline-replica\\[data-tone='${tone}'\\]\\s*\\{[^}]*background: ([^;]+);`))
			return match?.[1] ?? 'var(--tyto-track)'
		}
		const declared = ['filled', 'outline', 'grey'].map(unplayed)
		expect(new Set(declared).size).toBe(3)
		expect(declared[2]).toBe('var(--tyto-track)')
	})

	it('неразмеченный хвост записи без тона говорящего', () => {
		render(<ReplicaTimeline segments={segments} duration={200} currentTime={0} seekable onSeek={vi.fn()} onToggle={vi.fn()} />)
		const last = [...document.querySelectorAll('[data-replica-start]')].pop()!
		expect(last.getAttribute('data-replica-start')).toBe('120')
		expect(last.getAttribute('data-tone')).toBe('rest')
	})

	it('шкала не вылезает за край, если медиа короче расшифровки', () => {
		render(<ReplicaTimeline segments={segments} duration={1} currentTime={0} seekable onSeek={vi.fn()} onToggle={vi.fn()} />)
		const last = [...document.querySelectorAll<HTMLElement>('[data-replica-start]')].pop()!
		expect(last.style.left).toBe('75%')
	})

	it('клик по отрезку перематывает в точку под курсором, а не к началу серии', () => {
		const onSeek = vi.fn()
		// One speaker: the whole bar is a single series starting at 00:00.
		const single: Segment[] = [
			{ start: 0, stop: 6000, text: 'а', speaker: 0 },
			{ start: 6000, stop: 12000, text: 'б', speaker: 0 },
		] as Segment[]
		render(<ReplicaTimeline segments={single} duration={120} currentTime={0} seekable onSeek={onSeek} onToggle={vi.fn()} />)
		const slider = screen.getByRole('slider')
		slider.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 8, right: 500, bottom: 8, x: 100, y: 0, toJSON: () => ({}) })
		fireEvent.pointerDown(document.querySelector('[data-replica-start="0"]')!, { button: 0, pointerId: 1, clientX: 300 })
		expect(onSeek).toHaveBeenCalledExactlyOnceWith(60)
	})

	it('стрелки перематывают на 5 с, пробел ставит на паузу', () => {
		const onSeek = vi.fn()
		const onToggle = vi.fn()
		render(<ReplicaTimeline segments={segments} duration={120} currentTime={30} seekable onSeek={onSeek} onToggle={onToggle} />)
		const slider = screen.getByRole('slider')
		fireEvent.keyDown(slider, { key: 'ArrowRight' })
		fireEvent.keyDown(slider, { key: 'ArrowLeft' })
		fireEvent.keyDown(slider, { key: ' ' })
		expect(onSeek.mock.calls).toEqual([[35], [25]])
		expect(onToggle).toHaveBeenCalledOnce()
	})

	it('неотыгранные отрезки и дорожка одного цвета --tyto-track', () => {
		expect(css).toMatch(/\.tyto-timeline-replica\s*\{[^}]*background: var\(--tyto-track\)/)
	})

	it('плеер: квадратная кнопка 32 px и время «00:00 / --:--»', () => {
		const job = { id: 'j', name: 'Планерка', path: '/m/b.mp3', status: 'done', progress: 100, segments }
		render(
			<TooltipProvider>
				<PlayerBar job={job as never} />
			</TooltipProvider>,
		)
		const play = screen.getByRole('button', { name: 'Воспроизвести' })
		expect(play.className).toMatch(/h-8 w-8/)
		expect(play.className).not.toContain('rounded-full')
		expect(screen.getByText('00:00')).toBeTruthy()
		expect(document.querySelectorAll('[data-replica-start]')).toHaveLength(4)
	})
})

describe('плеер: показать запись в папке', () => {
	const job = { id: 'j', name: 'Планерка', path: '/m/meetings/plan.mp3', status: 'done', progress: 100, segments }
	const renderPlayer = () =>
		render(
			<TooltipProvider>
				<PlayerBar job={job as never} />
			</TooltipProvider>,
		)

	it('открывает папку исходного файла', async () => {
		renderPlayer()
		fireEvent.click(screen.getByRole('button', { name: 'Показать в папке' }))
		await vi.waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith('open_path', { path: '/m/meetings' }))
	})

	it('если папка не открылась, говорит об этом', async () => {
		vi.mocked(invoke).mockRejectedValueOnce(new Error('nope'))
		renderPlayer()
		fireEvent.click(screen.getByRole('button', { name: 'Показать в папке' }))
		await vi.waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Не удалось открыть папку с файлом', expect.anything()))
	})
})

describe('боковая панель: пока идет расшифровка и после изменений', () => {
	it('во время расшифровки записи истории не открываются и не подсвечиваются', async () => {
		session.value.queue = { ...session.value.queue, running: true }
		renderSidebar()
		const button = (await screen.findByText('Интервью: логист на склад')).closest('button')!
		expect(button.disabled).toBe(true)
		expect(css).toMatch(/\.tyto-recent:not\(\.tyto-recent-selected\):hover:not\(:has\(> \.tyto-recent-main:disabled\)\)/)
		expect(css).toMatch(/\.tyto-recent-main:disabled \.tyto-recent-title\s*\{[^}]*color: var\(--muted-foreground\)/)
	})

	it('длительность перечитывается, когда хранилище сообщает об изменении', async () => {
		renderSidebar()
		expect(await screen.findByText('09:15 · 22 мин')).toBeTruthy()
		store.durations['/p/long/transcript.vibe.json'] = 31 * 60
		window.dispatchEvent(new CustomEvent('transcripts-changed'))
		expect(await screen.findByText('09:15 · 31 мин')).toBeTruthy()
	})
})

describe('нижние полосы одной высоты (v2)', () => {
	it('нижняя полоса панели и плеер получают один класс .tyto-bar высотой --tyto-bar-h', () => {
		renderSidebar()
		const job = { id: 'j', name: 'Планерка', path: '/m/b.mp3', status: 'done', progress: 100, segments }
		render(
			<TooltipProvider>
				<PlayerBar job={job as never} />
			</TooltipProvider>,
		)
		expect(document.querySelectorAll('.tyto-bar')).toHaveLength(2)
		expect(screen.getByRole('slider').closest('.tyto-bar')).toBeTruthy()
		expect(css).toMatch(/\.tyto-bar\s*\{[^}]*height: var\(--tyto-bar-h\)[^}]*border-top: 1px solid var\(--border\)/)
	})
})
