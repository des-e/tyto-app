// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({
	listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
	emitted: [] as { target: string; event: string; payload: unknown }[],
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null), convertFileSrc: (path: string) => `asset://${path}` }))
vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(async (event: string, cb: (event: { payload: unknown }) => void) => {
		const set = tauri.listeners.get(event) ?? new Set()
		set.add(cb)
		tauri.listeners.set(event, set)
		return () => set.delete(cb)
	}),
	emit: vi.fn(),
	emitTo: vi.fn(async (target: string, event: string, payload: unknown) => {
		tauri.emitted.push({ target, event, payload })
	}),
}))
vi.mock('@tauri-apps/api/path', () => ({}))
vi.mock('@tauri-apps/plugin-dialog', () => ({}))
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(async () => true) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('~/lib/playback-rate', () => ({ usePlaybackRate: () => ({ playbackRate: 1, cyclePlaybackRate: vi.fn() }) }))

import { invoke } from '@tauri-apps/api/core'
import { TooltipProvider } from '~/components/ui/tooltip'
import { resetVideoWindow, syncVideoWindow, VIDEO_SYNC_EVENT } from '~/lib/tyto/video-window'
import type { Segment } from '~/lib/transcript'
import PlayerBar, { PLAYER_SEEK_EVENT, PLAYER_TIME_EVENT, type PlayerTimeDetail } from '~/pages/main/components/player-bar'
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
	resetVideoWindow()
	tauri.listeners.clear()
	tauri.emitted = []
	vi.mocked(invoke).mockClear()
	created = []
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
	return render(
		<TooltipProvider>
			<PlayerBar job={makeJob(path) as never} />
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

const inThumb = (v: Element) => !!document.querySelector('[data-slot="video-thumb"]')?.contains(v)
const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter((c) => c[0] === cmd)
const syncs = () => tauri.emitted.filter((e) => e.event === VIDEO_SYNC_EVENT)
const lastSync = () => syncs()[syncs().length - 1]

describe('видео в проекте: миниатюра в плеере', () => {
	it('проект с .mp4: видео миниатюрой слева от кнопки воспроизведения, одна шкала', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		expect(video).toBeInstanceOf(HTMLVideoElement)
		loaded(video, 1920)
		expect(inThumb(video)).toBe(true)
		const thumb = document.querySelector('.tyto-video-thumb')!
		const play = screen.getByRole('button', { name: 'Воспроизвести' })
		expect(thumb.compareDocumentPosition(play) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect(document.querySelectorAll('.tyto-timeline')).toHaveLength(1)
	})

	it('клик по реплике перематывает видео: video.currentTime = начало реплики', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		const video = media()
		loaded(video, 1920)
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

	it('MP4 без видеодорожки (videoWidth 0) и аудио: миниатюры нет', () => {
		open('C:/Users/Д/Documents/Tyto/Записи/Встреча.mp4')
		loaded(media(), 0)
		expect(document.querySelector('.tyto-video-thumb')).toBeNull()
		cleanup()
		created = []
		open('C:/Users/Д/Documents/Tyto/plan/plan.m4a')
		expect(media()).toBeInstanceOf(HTMLAudioElement)
		expect(document.querySelector('.tyto-video-thumb')).toBeNull()
	})
})

describe('видео в отдельном окне (вариант H)', () => {
	it('клик по миниатюре открывает окно с этим файлом, повторный клик закрывает', async () => {
		open('D:/zoom/plan.mp4')
		loaded(media(), 1280)
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Открыть видео в отдельном окне' }))
		})
		expect(calls('video_window_open')[0][1]).toEqual({ path: 'D:/zoom/plan.mp4', title: 'Планерка' })
		const thumb = screen.getByRole('button', { name: 'Закрыть окно с видео' })
		expect(thumb.getAttribute('aria-pressed')).toBe('true')
		// the window gets the position right away
		expect(lastSync()?.target).toBe('video-window')

		await act(async () => {
			fireEvent.click(thumb)
		})
		expect(calls('video_window_close')).toHaveLength(1)
		expect(screen.getByRole('button', { name: 'Открыть видео в отдельном окне' })).toBeTruthy()
	})

	it('окно закрыли крестиком: миниатюра снова «открыть»', async () => {
		open('D:/zoom/plan.mp4')
		loaded(media(), 1280)
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Открыть видео в отдельном окне' }))
		})
		act(() => {
			for (const cb of tauri.listeners.get('video-window-closed') ?? []) cb({ payload: null })
		})
		expect(screen.getByRole('button', { name: 'Открыть видео в отдельном окне' })).toBeTruthy()
	})

	it('перемотка в главном окне сразу уходит в окно видео', async () => {
		open('D:/zoom/plan.mp4')
		const video = media()
		loaded(video, 1280)
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Открыть видео в отдельном окне' }))
		})
		act(() => {
			window.dispatchEvent(new CustomEvent(PLAYER_SEEK_EVENT, { detail: { seconds: 600 } }))
		})
		expect(lastSync()?.payload).toMatchObject({ seconds: 600 })
	})

	it('клик по картинке в окне видео ставит главный плеер на паузу или пускает', async () => {
		open('D:/zoom/plan.mp4')
		const video = media()
		loaded(video, 1280)
		act(() => {
			for (const cb of tauri.listeners.get('video-window-toggle') ?? []) cb({ payload: null })
		})
		expect(video.play).toHaveBeenCalled()
	})

	it('другой проект: окно видео закрывается', async () => {
		const { unmount } = open('D:/zoom/plan.mp4')
		loaded(media(), 1280)
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Открыть видео в отдельном окне' }))
		})
		unmount()
		expect(calls('video_window_close')).toHaveLength(1)
	})
})

describe('синхронизация окна видео', () => {
	it('шлет только изменения: игра/пауза, скачок, раз в секунду при игре', async () => {
		const { openVideoWindow } = await import('~/lib/tyto/video-window')
		await openVideoWindow('D:/a.mp4', 'A')
		const before = syncs().length
		const now = vi.spyOn(performance, 'now')
		now.mockReturnValue(1000)
		syncVideoWindow({ seconds: 0, playing: true, rate: 1 }) // play: sent
		now.mockReturnValue(1250)
		syncVideoWindow({ seconds: 0.25, playing: true, rate: 1 }) // on track: not sent
		now.mockReturnValue(2050)
		syncVideoWindow({ seconds: 1.05, playing: true, rate: 1 }) // a second later: sent
		now.mockReturnValue(2100)
		syncVideoWindow({ seconds: 30, playing: true, rate: 1 }) // jump: sent
		now.mockReturnValue(2150)
		syncVideoWindow({ seconds: 30.05, playing: true, rate: 1.5 }) // speed: sent
		expect(syncs().length - before).toBe(4)
	})
})
