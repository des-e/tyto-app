// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useContext, useEffect } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
	type DownloadEvent = { event: 'Started'; data: { contentLength?: number } } | { event: 'Progress'; data: { chunkLength: number } }
	const state = {
		release: null as null | (() => void),
		onEvent: null as null | ((event: DownloadEvent) => void),
		body: 'Исправлена ошибка при экспорте.' as string,
		relaunch: vi.fn(),
		install: vi.fn(async () => {}),
		downloads: 0,
		setErrorModal: vi.fn(),
	}
	return state
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: h.relaunch }))
vi.mock('@tauri-apps/plugin-updater', () => ({
	check: vi.fn(async () => ({
		available: true,
		version: '0.2.0',
		body: h.body,
		date: '',
		download: (onEvent: (event: unknown) => void) => {
			h.downloads += 1
			h.onEvent = onEvent as never
			return new Promise<void>((resolve) => {
				h.release = resolve
			})
		},
		install: h.install,
	})),
}))

import { setLocale } from '~/paraglide/runtime.js'
import { UPDATE_PROMPTED_KEY, UpdaterContext, UpdaterProvider } from '~/providers/updater'
import { ErrorModalContext } from '~/providers/error-modal'
import { downloadSizeLabel } from '~/lib/tyto/format'
import UpdateWindow from './update-window'

function Opener() {
	const { updateApp, availableUpdate } = useContext(UpdaterContext)
	return (
		<button disabled={!availableUpdate} onClick={() => updateApp()}>
			open
		</button>
	)
}

/** Stands in for the main screen's gate (pages/main/page.tsx). */
function Ready({ ready }: { ready: boolean }) {
	const { setAutoPromptReady } = useContext(UpdaterContext)
	useEffect(() => setAutoPromptReady(ready), [ready, setAutoPromptReady])
	return null
}

function tree(ready?: boolean) {
	return (
		<ErrorModalContext.Provider value={{ state: { open: false, log: '' }, setState: h.setErrorModal } as never}>
			<UpdaterProvider>
				{ready !== undefined && <Ready ready={ready} />}
				<Opener />
				<UpdateWindow />
			</UpdaterProvider>
		</ErrorModalContext.Provider>
	)
}

function renderWindow(ready?: boolean) {
	return render(tree(ready))
}

async function openConfirm() {
	await waitFor(() => expect((screen.getByText('open') as HTMLButtonElement).disabled).toBe(false))
	fireEvent.click(screen.getByText('open'))
}

beforeAll(() => {
	setLocale('ru-RU', { reload: false })
})

beforeEach(() => {
	h.body = 'Исправлена ошибка при экспорте.'
	h.release = null
	h.onEvent = null
	h.relaunch.mockReset()
	h.install.mockClear()
	h.downloads = 0
	h.setErrorModal.mockReset()
	localStorage.clear()
})

afterEach(cleanup)

describe('update window', () => {
	it('confirm step: version, release notes, two buttons', async () => {
		renderWindow()
		await openConfirm()
		expect(await screen.findByText('Доступна версия 0.2.0')).toBeTruthy()
		expect(screen.getByText('Исправлена ошибка при экспорте.')).toBeTruthy()
		expect(screen.getByText('Обновить')).toBeTruthy()
		expect(screen.getByText('Позже')).toBeTruthy()
	})

	it('falls back to a plain line when the release has no notes', async () => {
		h.body = '  '
		renderWindow()
		await openConfirm()
		expect(await screen.findByText('В новой версии исправления и улучшения.')).toBeTruthy()
	})

	it('«Позже» closes the window', async () => {
		renderWindow()
		await openConfirm()
		fireEvent.click(await screen.findByText('Позже'))
		await waitFor(() => expect(screen.queryByTestId('update-window')).toBeNull())
	})

	it('download shows percent, size and the walking owl; done offers a relaunch', async () => {
		renderWindow()
		await openConfirm()
		fireEvent.click(await screen.findByText('Обновить'))

		expect(await screen.findByText('Скачиваю обновление')).toBeTruthy()
		act(() => {
			h.onEvent?.({ event: 'Started', data: { contentLength: 43_000_000 } })
			h.onEvent?.({ event: 'Progress', data: { chunkLength: 18_060_000 } })
		})
		expect(await screen.findByText('42 %')).toBeTruthy()
		expect(screen.getByText('18 из 43 МБ')).toBeTruthy()
		expect(screen.getByTestId('owl-walk').getAttribute('data-walking')).toBe('true')
		expect(screen.getByText('Не закрывайте программу, это займет минуту-другую.')).toBeTruthy()

		// Escape does not close it while the app downloads.
		fireEvent.keyDown(screen.getByTestId('update-window'), { key: 'Escape' })
		expect(screen.getByTestId('update-window')).toBeTruthy()

		await act(async () => h.release?.())
		expect(await screen.findByText('Готово')).toBeTruthy()
		expect(h.install).toHaveBeenCalledTimes(1)
		expect(screen.getByText('Tyto обновлен до версии 0.2.0. Перезапустить сейчас?')).toBeTruthy()

		fireEvent.click(screen.getByText('Перезапустить'))
		await waitFor(() => expect(h.relaunch).toHaveBeenCalledTimes(1))
	})

	it('unknown size: bytes only, no percent', async () => {
		renderWindow()
		await openConfirm()
		fireEvent.click(await screen.findByText('Обновить'))
		await screen.findByText('Скачиваю обновление')
		act(() => {
			h.onEvent?.({ event: 'Started', data: {} })
			h.onEvent?.({ event: 'Progress', data: { chunkLength: 18_000_000 } })
		})
		expect(await screen.findByText('Скачано 18 МБ')).toBeTruthy()
		expect(screen.queryByText(/ %$/)).toBeNull()
	})

	it('contentLength 0 counts as unknown size', async () => {
		renderWindow()
		await openConfirm()
		fireEvent.click(await screen.findByText('Обновить'))
		await screen.findByText('Скачиваю обновление')
		act(() => {
			h.onEvent?.({ event: 'Started', data: { contentLength: 0 } })
			h.onEvent?.({ event: 'Progress', data: { chunkLength: 18_000_000 } })
		})
		expect(await screen.findByText('Скачано 18 МБ')).toBeTruthy()
		expect(screen.queryByText(/ %$/)).toBeNull()
	})

	it('a double click on «Обновить» starts one download', async () => {
		renderWindow()
		await openConfirm()
		const button = await screen.findByText('Обновить')
		fireEvent.click(button)
		fireEvent.click(button)
		await screen.findByText('Скачиваю обновление')
		expect(h.downloads).toBe(1)
	})

	it('a failed relaunch shows the error modal', async () => {
		h.relaunch.mockRejectedValue(new Error('relaunch failed'))
		renderWindow()
		await openConfirm()
		fireEvent.click(await screen.findByText('Обновить'))
		await screen.findByText('Скачиваю обновление')
		await act(async () => h.release?.())
		fireEvent.click(await screen.findByText('Перезапустить'))
		await waitFor(() => expect(h.setErrorModal).toHaveBeenCalledWith({ open: true, log: 'Error: relaunch failed' }))
	})
})

describe('update window opens by itself', () => {
	it('once the main screen is idle, and remembers the version', async () => {
		renderWindow(true)
		expect(await screen.findByText('Доступна версия 0.2.0')).toBeTruthy()
		expect(localStorage.getItem(UPDATE_PROMPTED_KEY)).toBe('0.2.0')
		fireEvent.click(screen.getByText('Позже'))
		await waitFor(() => expect(screen.queryByTestId('update-window')).toBeNull())
		// The update button stays.
		expect((screen.getByText('open') as HTMLButtonElement).disabled).toBe(false)
	})

	it('not again for a version it already showed', async () => {
		localStorage.setItem(UPDATE_PROMPTED_KEY, '0.2.0')
		renderWindow(true)
		await waitFor(() => expect((screen.getByText('open') as HTMLButtonElement).disabled).toBe(false))
		expect(screen.queryByTestId('update-window')).toBeNull()
	})

	it('again for a newer version', async () => {
		localStorage.setItem(UPDATE_PROMPTED_KEY, '0.1.9')
		renderWindow(true)
		expect(await screen.findByText('Доступна версия 0.2.0')).toBeTruthy()
	})

	it('waits while the app is busy, then opens when it frees up', async () => {
		const view = renderWindow(false)
		await waitFor(() => expect((screen.getByText('open') as HTMLButtonElement).disabled).toBe(false))
		expect(screen.queryByTestId('update-window')).toBeNull()
		view.rerender(tree(true))
		expect(await screen.findByText('Доступна версия 0.2.0')).toBeTruthy()
	})

	it('does not reopen in the same session after «Позже»', async () => {
		const view = renderWindow(true)
		fireEvent.click(await screen.findByText('Позже'))
		await waitFor(() => expect(screen.queryByTestId('update-window')).toBeNull())
		localStorage.clear()
		view.rerender(tree(false))
		view.rerender(tree(true))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(screen.queryByTestId('update-window')).toBeNull()
	})
})

describe('downloadSizeLabel', () => {
	it('whole megabytes from 10 МБ up', () => {
		expect(downloadSizeLabel(18e6, 43e6, 'ru-RU')).toBe('18 из 43 МБ')
	})

	it('one decimal when the file is under 10 МБ', () => {
		expect(downloadSizeLabel(2.5e6, 8.25e6, 'ru-RU')).toBe('2,5 из 8,3 МБ')
	})

	it('english wording', () => {
		setLocale('en-US', { reload: false })
		expect(downloadSizeLabel(18e6, 43e6, 'en-US')).toBe('18 of 43 MB')
		expect(downloadSizeLabel(18e6, null, 'en-US')).toBe('Downloaded 18 MB')
		setLocale('ru-RU', { reload: false })
	})

	it('never shows more than the total', () => {
		expect(downloadSizeLabel(45e6, 43e6, 'ru-RU')).toBe('43 из 43 МБ')
	})

	it('only what arrived when the total is unknown', () => {
		expect(downloadSizeLabel(18e6, null, 'ru-RU')).toBe('Скачано 18 МБ')
	})
})
