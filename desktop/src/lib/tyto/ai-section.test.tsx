// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const httpFetch = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({}))
vi.mock('@tauri-apps/plugin-dialog', () => ({}))
vi.mock('@tauri-apps/plugin-fs', () => ({}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...args: unknown[]) => httpFetch(...args) }))
const openUrl = vi.fn()
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (url: string) => openUrl(url) }))

import { TooltipProvider } from '~/components/ui/tooltip'
import { m } from '~/paraglide/messages.js'
import { DEFAULT_AI, TYTO_BOT_BUY_URL, TYTO_BOT_URL, formatHours, type AiConnection, type AiSettings } from '~/lib/ai'
import { AiSection } from '~/pages/settings/sections/ai'
import type { SettingsViewModel } from '~/pages/settings/sections/shared'

afterEach(() => {
	cleanup()
	httpFetch.mockReset()
	openUrl.mockReset()
})

function renderAi(connection: Partial<AiConnection>) {
	const setAi = vi.fn()
	const ai: AiSettings = { ...DEFAULT_AI, connection: { ...DEFAULT_AI.connection, ...connection } }
	const vm = { preference: { ai, setAi }, aiTest: null, testAi: vi.fn(), copyAiError: vi.fn(), aiErrorCopied: false } as unknown as SettingsViewModel
	render(
		<TooltipProvider>
			<AiSection vm={vm} onOpenPrompt={vi.fn()} />
		</TooltipProvider>,
	)
	return { setAi, last: () => setAi.mock.calls[setAi.mock.calls.length - 1][0] as AiSettings }
}

const STATUS = { tier: 'sipukha', tier_name: 'Сипуха', limit_s: 30 * 3600, used_s: 56400, left_s: 51600, review: true, period_end: 1796368716 }

describe('Tyto: раздел «ИИ-ассистент», вариант B', () => {
	it('сверху выбор «Какой ИИ» из трех вариантов, выбран Tyto ИИ', () => {
		renderAi({ platform: 'tyto', tytoCode: '' })
		const group = screen.getByRole('radiogroup', { name: m.aiWhich() })
		expect([...group.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual([m.tytoAiPlatform(), m.aiOwnKey(), m.aiOllamaLocal()])
		expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe(m.tytoAiPlatform())
	})

	it('без кода: кнопка «Получить код в Telegram» ведет в бота, остатка и покупки нет', () => {
		renderAi({ platform: 'tyto', tytoCode: '' })
		fireEvent.click(screen.getByRole('button', { name: m.tytoAiGetCode() }))
		expect(openUrl).toHaveBeenCalledWith(TYTO_BOT_URL)
		expect(screen.queryByText(m.tytoAiMoreHours())).toBeNull()
		expect(httpFetch).not.toHaveBeenCalled()
	})

	it('с кодом: остаток часов, дата обновления, «Есть в уровне» и покупка звёздами', async () => {
		httpFetch.mockResolvedValue(new Response(JSON.stringify(STATUS), { status: 200 }))
		renderAi({ platform: 'tyto', tytoCode: 'TYTO-TEST-0001' })
		const line = m.tytoAiStatus({ tier: 'Сипуха', left: formatHours(STATUS.left_s), limit: formatHours(STATUS.limit_s) })
		expect(await screen.findByText(line, {}, { timeout: 2000 })).toBeTruthy()
		expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('48')
		expect(screen.getByText(m.tytoAiInLevel())).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: m.tytoAiPayStars() }))
		expect(openUrl).toHaveBeenCalledWith(TYTO_BOT_BUY_URL)
	})

	it('ошибка сервера видна в строке остатка, с кнопкой проверить еще раз', async () => {
		httpFetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'Код не найден или отозван.' }), { status: 401 }))
		renderAi({ platform: 'tyto', tytoCode: 'TYTO-BAD0-0000' })
		expect(await screen.findByText('Код не найден или отозван.', {}, { timeout: 2000 })).toBeTruthy()
		expect(screen.getByRole('button', { name: m.tytoAiRefresh() })).toBeTruthy()
	})

	it('«Свой ключ» переключает на Claude и показывает выбор сервиса', () => {
		const { last } = renderAi({ platform: 'tyto', tytoCode: '' })
		fireEvent.click(screen.getByRole('radio', { name: m.aiOwnKey() }))
		expect(last().connection.platform).toBe('claude')
	})

	it('со своим ключом есть «Сервис», проверка подключения и промпты задач', () => {
		renderAi({ platform: 'openai' })
		expect(screen.getByLabelText(m.aiService())).toBeTruthy()
		expect(screen.getByText(m.aiTestConnection())).toBeTruthy()
		expect(screen.getAllByRole('button', { name: m.aiEditPrompt() })).toHaveLength(2)
	})

	it('Tyto ИИ: одна галочка «Саммари и темы для каждой новой записи» включает и сами саммари', () => {
		const { last } = renderAi({ platform: 'tyto', tytoCode: '' })
		fireEvent.click(screen.getByRole('switch', { name: m.tytoAiAutoSummary() }))
		expect(last().tasks.summary).toMatchObject({ enabled: true, autoOnFinish: true })
	})
})
