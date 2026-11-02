// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null), convertFileSrc: (path: string) => `asset://${path}` }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({}))
vi.mock('@tauri-apps/plugin-dialog', () => ({}))
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(async () => true) }))
const win = vi.hoisted(() => ({ setFullscreen: vi.fn(async () => {}) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('~/lib/playback-rate', () => ({ usePlaybackRate: () => ({ playbackRate: 1, cyclePlaybackRate: vi.fn() }) }))

// The text column is not under test: stand-ins mark where it lands.
vi.mock('~/pages/main/components/transcript-view', () => ({ default: () => <div data-testid="transcript">Текст</div> }))
vi.mock('~/pages/main/components/transcript-toolbar', () => ({ default: () => <div data-testid="toolbar" /> }))
vi.mock('~/pages/main/components/batch-banner', () => ({ default: () => null }))
vi.mock('~/pages/main/components/file-queue', () => ({ default: () => null }))
vi.mock('~/pages/main/hooks/use-transcript-view', () => ({ useTranscriptViewOptions: () => ({}) }))

const session = vi.hoisted(() => ({
	value: {
		queue: { jobs: [] as unknown[], selectedJob: null as unknown, selectedId: 'j' as string | null },
		summaries: { showSummary: null, clearShowSummary: () => {} },
	},
}))
vi.mock('~/pages/main/session', () => ({ useSession: () => session.value }))

import { TooltipProvider } from '~/components/ui/tooltip'
import { deleteConfig, readConfig, writeConfig } from '~/lib/config-store'
import { resetVideoView, VIDEO_PANE_OPEN_KEY, VIDEO_SIDE_QUERY } from '~/lib/tyto/player-media'
import type { Segment } from '~/lib/transcript'
import PlayerBar, { PLAYER_SEEK_EVENT, PLAYER_TIME_EVENT, type PlayerTimeDetail } from '~/pages/main/components/player-bar'
import SessionView from '~/pages/main/components/session-view'
import { setLocale } from '~/paraglide/runtime.js'

const segments: Segment[] = [
	{ start: 0, stop: 2400, text: 'Начнем с поставок', speaker: 0 },
	{ start: 2400, stop: 5100, text: 'Сроки сдвигаются', speaker: 1 },
]

function makeJob(path: string) {
	return { id: 'j', name: 'Планерка', path, status: 'done', progress: 100, segments, savedPath: '/p/plan/transcript.vibe.json', hydrated: true }
}

// jsdom has no media pipeline: time, size and play/pause are plain fields here.
type FakeMedia = HTMLMediaElement & { _t?: number; _w?: number }
let created: HTMLMediaElement[] = []

/** The window width the video layout sees (jsdom has no matchMedia of its own). */
function windowIs(wide: boolean) {
	window.matchMedia = ((query: string) => ({
		matches: query === VIDEO_SIDE_QUERY ? wide : false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
	})) as unknown as typeof window.matchMedia
	resetVideoView()
}

beforeAll(() => {
	setLocale('ru-RU', { reload: false })
	const proto = HTMLMediaElement.prototype as FakeMedia
	Object.defineProperty(proto, 'currentTime', {
		configurable: true,
		get(this: FakeMedia) {
			return this._t ?? 0
		},
		set(this: FakeMedia, v: number) {
			this._t = v
		},
	})
	Object.defineProperty(proto, 'duration', { configurable: true, get: () => 3600 })
	Object.defineProperty(proto, 'paused', { configurable: true, get: () => true })
	proto.play = vi.fn(async () => {})
	proto.pause = vi.fn()
	Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
		configurable: true,
		get(this: FakeMedia) {
			return this._w ?? 0
		},
	})
})

beforeEach(() => {
	deleteConfig(VIDEO_PANE_OPEN_KEY)
	windowIs(true)
	created = []
	win.setFullscreen.mockClear()
	const make = document.createElement.bind(document)
	vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
		const el = make(tag, options)
		if (el instanceof HTMLMediaElement) created.push(el)
		return el
	}) as typeof document.createElement)
	const OriginalAudio = window.Audio
	vi.spyOn(window, 'Audio').mockImplementation(function (src?: string) {
		const el = new OriginalAudio(src)
		if (!created.includes(el)) created.push(el)
		return el
	} as never)
})

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

function open(path: string) {
	const job = makeJob(path)
	session.value.queue = { jobs: [job], selectedJob: job, selectedId: 'j' }
	return render(
		<TooltipProvider>
			<SessionView />
			<PlayerBar job={job as never} />
		</TooltipProvider>,
	)
}

function media() {
	expect(created).toHaveLength(1)
	return created[0] as FakeMedia
}

/** The metadata arrives: `width` 0 means an MP4 with sound only. */
function loaded(el: FakeMedia, width: number) {
	el._w = width
	act(() => {
		el.dispatchEvent(new Event('loadedmetadata'))
	})
}

const inSide = (v: Element) => !!document.querySelector('.tyto-video-side [data-slot="video"]')?.contains(v)
const inThumb = (v: Element) => !!document.querySelector('[data-slot="video-thumb"]')?.contains(v)
const inLayer = (v: Element) => !!document.querySelector('[data-slot="video-fullscreen"]')?.contains(v)

describe('по умолчанию видео скрыто', () => {
	it('широкое окно, выбора еще не было: колонки нет, видео миниатюрой в плеере', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		loaded(video, 1920)
		expect(document.querySelector('.tyto-video-side')).toBeNull()
		expect(inThumb(video)).toBe(true)
	})
})

describe('широкое окно: видео в колонке справа от текста (вариант E)', () => {
	beforeEach(() => {
		writeConfig(VIDEO_PANE_OPEN_KEY, true)
		resetVideoView()
	})

	it('проект с .mp4: текст слева, видео справа, под ним место для тем; внизу одна шкала', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		expect(video).toBeInstanceOf(HTMLVideoElement)
		loaded(video, 1920)
		expect(inSide(video)).toBe(true)
		const transcript = screen.getByTestId('transcript')
		expect(transcript.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect(document.querySelector('.tyto-video-side [data-slot="topics"]')).not.toBeNull()
		expect(document.querySelector('.tyto-video-thumb')).toBeNull()
		expect(document.querySelectorAll('.tyto-timeline')).toHaveLength(1)
	})

	it('клик по реплике перематывает видео: video.currentTime = начало реплики', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		loaded(video, 1920)
		// what a click on the second replica sends (transcript-view.tsx)
		act(() => {
			window.dispatchEvent(new CustomEvent(PLAYER_SEEK_EVENT, { detail: { seconds: segments[1].start / 100 } }))
		})
		expect(video.currentTime).toBe(24)
	})

	it('время видео подсвечивает текущую реплику (PLAYER_TIME_EVENT)', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		loaded(video, 1920)
		const seen: number[] = []
		const onTime = (e: Event) => seen.push((e as CustomEvent<PlayerTimeDetail>).detail.seconds)
		window.addEventListener(PLAYER_TIME_EVENT, onTime)
		video.currentTime = 30
		act(() => {
			video.dispatchEvent(new Event('timeupdate'))
		})
		window.removeEventListener(PLAYER_TIME_EVENT, onTime)
		expect(seen).toContain(30)
	})

	it('«На весь экран» разворачивает окно, Esc возвращает видео в колонку', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		loaded(video, 1920)
		fireEvent.click(screen.getByRole('button', { name: 'На весь экран' }))
		expect(win.setFullscreen).toHaveBeenLastCalledWith(true)
		expect(inLayer(video)).toBe(true)
		expect(screen.getByRole('button', { name: 'Обычный размер' })).toBeTruthy()

		fireEvent.keyDown(window, { key: 'Escape' })
		expect(win.setFullscreen).toHaveBeenLastCalledWith(false)
		expect(document.querySelector('[data-slot="video-fullscreen"]')).toBeNull()
		expect(inSide(video)).toBe(true)
	})

	it('«Скрыть видео»: колонки нет, видео миниатюрой в плеере; клик по миниатюре возвращает колонку; выбор запоминается', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		loaded(video, 1920)
		fireEvent.click(screen.getByRole('button', { name: 'Скрыть видео' }))
		expect(document.querySelector('.tyto-video-side')).toBeNull()
		expect(inThumb(video)).toBe(true)
		expect(readConfig(VIDEO_PANE_OPEN_KEY, true)).toBe(false)

		fireEvent.click(screen.getByRole('button', { name: 'Показать видео' }))
		expect(inSide(video)).toBe(true)
		expect(readConfig(VIDEO_PANE_OPEN_KEY, false)).toBe(true)
	})

	it('MP4 без видеодорожки (videoWidth 0): экран как при аудио', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		loaded(video, 0)
		expect(video.isConnected).toBe(false)
		expect(document.querySelector('.tyto-video-side')).toBeNull()
		expect(document.querySelector('.tyto-video-thumb')).toBeNull()
		expect(screen.getByTestId('transcript')).toBeTruthy()
	})

	it('перетащенная запись Zoom (.mp4 вне Записи/) открывается так же', () => {
		open('D:/zoom/plan.mp4')
		const video = media()
		loaded(video, 1280)
		expect(inSide(video)).toBe(true)
	})

	it('аудиопроект: ни колонки, ни миниатюры, плеер как раньше', () => {
		open('C:/Users/Д/Documents/Tyto/plan/plan.m4a')
		const audio = media()
		expect(audio).toBeInstanceOf(HTMLAudioElement)
		expect(audio.isConnected).toBe(false)
		expect(document.querySelector('.tyto-video-side')).toBeNull()
		expect(document.querySelector('.tyto-video-thumb')).toBeNull()
	})

	it('другой проект: видео уходит с экрана и останавливается', () => {
		const { unmount } = open('D:/zoom/plan.mp4')
		const video = media()
		loaded(video, 1280)
		unmount()
		expect(video.isConnected).toBe(false)
		expect(video.pause).toHaveBeenCalled()
	})
})

describe('узкое окно: миниатюра в плеере (вариант A)', () => {
	beforeEach(() => windowIs(false))

	it('видео миниатюрой слева в плеере, колонки нет, текст на всю ширину', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		loaded(video, 1920)
		expect(inThumb(video)).toBe(true)
		expect(document.querySelector('.tyto-video-side')).toBeNull()
		const thumb = document.querySelector('.tyto-video-thumb')!
		const play = screen.getByRole('button', { name: 'Воспроизвести' })
		expect(thumb.compareDocumentPosition(play) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
	})

	it('клик по миниатюре открывает полный экран, Esc возвращает в миниатюру', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		loaded(video, 1920)
		fireEvent.click(screen.getByRole('button', { name: 'На весь экран' }))
		expect(win.setFullscreen).toHaveBeenLastCalledWith(true)
		expect(inLayer(video)).toBe(true)
		fireEvent.keyDown(window, { key: 'Escape' })
		expect(inThumb(video)).toBe(true)
	})

	it('другой проект во время полного экрана: окно возвращается в обычный размер', () => {
		const { unmount } = open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		loaded(video, 1920)
		fireEvent.click(screen.getByRole('button', { name: 'На весь экран' }))
		unmount()
		expect(win.setFullscreen).toHaveBeenLastCalledWith(false)
	})
})
