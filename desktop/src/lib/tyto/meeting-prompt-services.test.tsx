// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const prompt = vi.hoisted(() => ({ source: 'telemost' }))
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (cmd: string) => (cmd === 'get_meeting_prompt_state' ? { source: prompt.source } : null)),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => ({ setTheme: async () => {} }) }))
vi.mock('~/lib/config-store', () => ({ readConfig: (_key: string, fallback: unknown) => fallback }))

import { setLocale } from '~/paraglide/runtime.js'
import MeetingPromptWindow from '~/windows/meeting-prompt-window'

beforeAll(() => setLocale('ru-RU', { reload: false }))
afterEach(cleanup)

describe('плашка «Идет созвон»: новые сервисы', () => {
	it.each([
		['telemost', 'Яндекс Телемост'],
		['bitrix24', 'Битрикс24'],
	])('%s показывается по имени', async (source, name) => {
		prompt.source = source
		render(<MeetingPromptWindow />)
		expect(await screen.findByText(new RegExp(name))).toBeTruthy()
	})
})

describe('плашка «Идет созвон»: кнопки', () => {
	it('«Записать» и «С видео» передают режим и сервис; без видео кнопки «С видео» нет', async () => {
		const { emit } = await import('@tauri-apps/api/event')
		const { invoke } = await import('@tauri-apps/api/core')
		const { fireEvent } = await import('@testing-library/react')
		prompt.source = 'telemost'
		vi.mocked(invoke).mockImplementation((async (cmd: string) => {
			if (cmd === 'get_meeting_prompt_state') return { source: prompt.source }
			if (cmd === 'screen_capture_support') return { video: true, pillExcluded: true }
			return null
		}) as never)
		// the prompt takes its language from the settings, empty here: English
		render(<MeetingPromptWindow />)
		fireEvent.click(await screen.findByRole('button', { name: 'With video' }))
		expect(emit).toHaveBeenCalledWith('meeting-prompt-start-recording', { microphone: true, systemAudio: true, mode: 'video', source: 'telemost' })
		cleanup()

		vi.mocked(invoke).mockImplementation((async (cmd: string) => (cmd === 'get_meeting_prompt_state' ? { source: 'bitrix24' } : null)) as never)
		render(<MeetingPromptWindow />)
		fireEvent.click(await screen.findByRole('button', { name: 'Record' }))
		expect(emit).toHaveBeenLastCalledWith('meeting-prompt-start-recording', { microphone: true, systemAudio: true, mode: 'audio', source: 'bitrix24' })
		expect(screen.queryByRole('button', { name: 'With video' })).toBeNull()
	})
})
