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
