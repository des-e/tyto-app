// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({
	listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
	emitted: [] as { target: string; event: string }[],
}))
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (cmd: string) => (cmd === 'video_window_source' ? { path: 'D:/zoom/plan.mp4', title: 'Планерка' } : null)),
	convertFileSrc: (path: string) => `asset://${path}`,
}))
vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(async (event: string, cb: (event: { payload: unknown }) => void) => {
		const set = tauri.listeners.get(event) ?? new Set()
		set.add(cb)
		tauri.listeners.set(event, set)
		return () => set.delete(cb)
	}),
	emitTo: vi.fn(async (target: string, event: string) => {
		tauri.emitted.push({ target, event })
	}),
}))

import VideoWindow from '~/windows/video-window'

type FakeMedia = HTMLMediaElement & { _t?: number; _paused?: boolean }

beforeAll(() => {
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
	Object.defineProperty(proto, 'paused', {
		configurable: true,
		get(this: FakeMedia) {
			return this._paused ?? true
		},
	})
	proto.play = vi.fn(async function (this: FakeMedia) {
		this._paused = false
	})
	proto.pause = vi.fn(function (this: FakeMedia) {
		this._paused = true
	})
})

afterEach(cleanup)

function sync(payload: unknown) {
	act(() => {
		for (const cb of tauri.listeners.get('video-sync') ?? []) cb({ payload })
	})
}

describe('окно видео', () => {
	it('показывает файл проекта без звука и говорит главному окну, что готово', async () => {
		render(<VideoWindow />)
		await act(async () => {})
		const video = document.querySelector('video')!
		expect(video.getAttribute('src')).toBe('asset://D:/zoom/plan.mp4')
		expect(video.muted).toBe(true)
		expect(tauri.emitted).toContainEqual({ target: 'main', event: 'video-window-ready' })
	})

	it('следует за главным плеером: позиция, игра, пауза, скорость; мелкий сдвиг не дергает', async () => {
		render(<VideoWindow />)
		await act(async () => {})
		const video = document.querySelector('video') as FakeMedia
		sync({ seconds: 120, playing: true, rate: 1.5 })
		expect(video.currentTime).toBe(120)
		expect(video.paused).toBe(false)
		expect(video.playbackRate).toBe(1.5)
		video.currentTime = 120.2
		sync({ seconds: 120.4, playing: true, rate: 1.5 })
		expect(video.currentTime).toBe(120.2)
		sync({ seconds: 121, playing: false, rate: 1.5 })
		expect(video.paused).toBe(true)
	})

	it('клик по картинке просит главное окно поставить на паузу или пустить', async () => {
		render(<VideoWindow />)
		await act(async () => {})
		fireEvent.click(document.querySelector('video')!)
		expect(tauri.emitted).toContainEqual({ target: 'main', event: 'video-window-toggle' })
	})
})
