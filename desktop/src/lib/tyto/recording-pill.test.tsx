// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const bus = vi.hoisted(() => {
	const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>()
	return {
		listeners,
		emit(event: string, payload?: unknown) {
			for (const cb of [...(listeners.get(event) ?? [])]) cb({ payload })
		},
	}
})
const backend = vi.hoisted(() => ({
	ready: null as unknown,
	calls: [] as string[],
}))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (cmd: string) => {
		backend.calls.push(cmd)
		if (cmd === 'recording_pill_ready') return backend.ready
		return undefined
	}),
}))
vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(async (event: string, cb: (event: { payload: unknown }) => void) => {
		let set = bus.listeners.get(event)
		if (!set) bus.listeners.set(event, (set = new Set()))
		set.add(cb)
		return () => set.delete(cb)
	}),
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
	getCurrentWebviewWindow: () => ({ setTheme: async () => {} }),
}))
vi.mock('~/lib/config-store', () => ({
	readConfig: (key: string, fallback: unknown) => (key === 'general.displayLanguage' ? 'ru-RU' : fallback),
}))

import RecordingPillWindow from '~/windows/recording-pill-window'

beforeEach(() => {
	bus.listeners.clear()
	backend.calls = []
	backend.ready = { status: 'recording', mode: 'audio', activeMs: 7_000 }
})

afterEach(() => {
	cleanup()
})

test('плашка: сова, красная точка мигает при записи и не мигает на паузе, таймер, «Пауза»/«Продолжить», «Стоп»', async () => {
	render(<RecordingPillWindow />)
	expect(await screen.findByText('0:07')).toBeTruthy()
	expect(screen.getByTestId('owl-mark')).toBeTruthy()
	expect(screen.getByTestId('recording-dot').getAttribute('data-blinking')).toBe('true')
	expect(screen.getByRole('button', { name: 'Стоп' })).toBeTruthy()

	fireEvent.click(screen.getByRole('button', { name: 'Пауза' }))
	await waitFor(() => expect(backend.calls).toContain('recording_pause'))

	act(() => bus.emit('recording_state', { status: 'paused', mode: 'audio', activeMs: 12_000 }))
	expect(screen.getByText('0:12')).toBeTruthy()
	expect(screen.getByTestId('recording-dot').getAttribute('data-blinking')).toBe('false')
	await waitFor(() => expect((screen.getByRole('button', { name: 'Продолжить' }) as HTMLButtonElement).disabled).toBe(false))
	fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }))
	await waitFor(() => expect(backend.calls).toContain('recording_resume'))

	// Everything but the buttons drags the pill.
	expect(screen.getByTestId('recording-pill-label').hasAttribute('data-tauri-drag-region')).toBe(true)
	expect(screen.getByRole('button', { name: 'Стоп' }).closest('[data-tauri-drag-region]')).not.toBeNull()
	expect(screen.getByRole('button', { name: 'Стоп' }).hasAttribute('data-tauri-drag-region')).toBe(false)
})

test('«Стоп» вызывает recording_stop; в состоянии finishing кнопки неактивны и видно «Сохраняем запись»', async () => {
	render(<RecordingPillWindow />)
	fireEvent.click(await screen.findByRole('button', { name: 'Стоп' }))
	await waitFor(() => expect(backend.calls).toContain('recording_stop'))

	act(() => bus.emit('recording_state', { status: 'finishing', mode: 'audio', activeMs: 9_000 }))
	expect(screen.getByText('Сохраняем запись')).toBeTruthy()
	await waitFor(() => {
		for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true)
	})
	expect(screen.queryByTestId('recording-dot')).toBeNull()

	act(() => bus.emit('recording_finished', { path: '/r.m4a' }))
	expect(screen.queryByRole('button')).toBeNull()
})

test('без записи плашка пустая', async () => {
	backend.ready = null
	const { container } = render(<RecordingPillWindow />)
	await waitFor(() => expect(backend.calls).toContain('recording_pill_ready'))
	expect(container.innerHTML).toBe('')
})
