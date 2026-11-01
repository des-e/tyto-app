// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({ targets: { monitors: [], windows: [] } as unknown }))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (cmd: string) => (cmd === 'list_capture_targets' ? backend.targets : undefined)),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))

import { setLocale } from '~/paraglide/runtime.js'
import { CaptureTargetDialog } from './capture-target-dialog'

const monitor = (id: string, width: number, height: number, primary = false) => ({ id, name: id, width, height, primary })
const win = (id: string, title: string, appName: string) => ({ id, title, appName })

beforeAll(() => setLocale('ru-RU', { reload: false }))
beforeEach(() => {
	backend.targets = { monitors: [], windows: [] }
})
afterEach(cleanup)

function renderDialog() {
	const onCancel = vi.fn()
	const onStart = vi.fn()
	render(<CaptureTargetDialog open onCancel={onCancel} onStart={onStart} />)
	return { onCancel, onStart }
}

const startButton = () => screen.getByRole('button', { name: 'Начать запись' }) as HTMLButtonElement

describe('CaptureTargetDialog «Что записывать»', () => {
	it('один монитор: выбор экрана не показан, старт записывает этот монитор', async () => {
		backend.targets = { monitors: [monitor('m1', 1920, 1080, true)], windows: [] }
		const { onStart } = renderDialog()
		expect(screen.getByText('Что записывать')).toBeTruthy()
		await waitFor(() => expect(startButton().disabled).toBe(false))
		expect(screen.queryByText(/Экран 1/)).toBeNull()
		fireEvent.click(startButton())
		expect(onStart).toHaveBeenCalledWith({ kind: 'monitor', id: 'm1' })
	})

	it('два монитора: можно выбрать второй, по умолчанию основной', async () => {
		backend.targets = { monitors: [monitor('m1', 1920, 1080), monitor('m2', 2560, 1440, true)], windows: [] }
		const { onStart } = renderDialog()
		const second = await screen.findByRole('radio', { name: 'Экран 2, 2560×1440' })
		expect(second.getAttribute('aria-checked')).toBe('true')
		fireEvent.click(screen.getByRole('radio', { name: 'Экран 1, 1920×1080' }))
		fireEvent.click(startButton())
		expect(onStart).toHaveBeenCalledWith({ kind: 'monitor', id: 'm1' })
	})

	it('«Одно окно»: список с программой, выбор окна дает target window', async () => {
		backend.targets = {
			monitors: [monitor('m1', 1920, 1080, true)],
			windows: [win('w1', 'Созвон с командой', 'Zoom'), win('w2', 'Отчет.xlsx', 'Excel')],
		}
		const { onStart } = renderDialog()
		await waitFor(() => expect(startButton().disabled).toBe(false))
		fireEvent.click(screen.getByRole('radio', { name: 'Одно окно' }))
		const row = screen.getByRole('radio', { name: /Отчет\.xlsx/ })
		expect(within(row).getByText('Excel')).toBeTruthy()
		// no window chosen yet
		expect(startButton().disabled).toBe(true)
		fireEvent.click(row)
		expect(startButton().disabled).toBe(false)
		fireEvent.click(startButton())
		expect(onStart).toHaveBeenCalledWith({ kind: 'window', id: 'w2' })
	})

	it('нет окон: «Открытых окон не найдено», «Начать запись» неактивна', async () => {
		backend.targets = { monitors: [monitor('m1', 1920, 1080, true)], windows: [] }
		renderDialog()
		await waitFor(() => expect(startButton().disabled).toBe(false))
		fireEvent.click(screen.getByRole('radio', { name: 'Одно окно' }))
		expect(screen.getByText('Открытых окон не найдено')).toBeTruthy()
		expect(startButton().disabled).toBe(true)
	})

	it('«Отмена» закрывает без старта', async () => {
		const { onCancel, onStart } = renderDialog()
		fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
		expect(onCancel).toHaveBeenCalled()
		expect(onStart).not.toHaveBeenCalled()
	})
})
