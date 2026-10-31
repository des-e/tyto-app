// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({}))
vi.mock('@tauri-apps/plugin-dialog', () => ({}))
vi.mock('@tauri-apps/plugin-fs', () => ({}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))

import { TooltipProvider } from '~/components/ui/tooltip'
import { m } from '~/paraglide/messages.js'
import { DEFAULT_AI, defaultModel, type AiConnection, type AiSettings } from '~/lib/ai'
import { proxyAddressPatch, proxyFormatPatch } from './proxy-fields'
import { AiSection } from '~/pages/settings/sections/ai'
import type { SettingsViewModel } from '~/pages/settings/sections/shared'

afterEach(cleanup)

function renderAi(connection: Partial<AiConnection>) {
	const setAi = vi.fn()
	const ai: AiSettings = { ...DEFAULT_AI, connection: { ...DEFAULT_AI.connection, ...connection } }
	const vm = { preference: { ai, setAi }, aiTest: null, testAi: vi.fn(), copyAiError: vi.fn(), aiErrorCopied: false } as unknown as SettingsViewModel
	const view = render(
		<TooltipProvider>
			<AiSection vm={vm} onOpenPrompt={vi.fn()} />
		</TooltipProvider>,
	)
	const lastConnection = () => (setAi.mock.calls[setAi.mock.calls.length - 1][0] as AiSettings).connection
	return { view, setAi, lastConnection }
}

describe('Tyto: ИИ через прокси-сервис в настройках', () => {
	it('у прокси поля «Адрес API», «Ключ», «Модель», переключатель формата и подсказка', () => {
		const { view } = renderAi({ platform: 'proxy', proxyBaseUrl: 'https://x.top/v1', proxyFormat: 'openai' })
		expect(view.getByText(m.aiProxyHint())).toBeTruthy()
		expect((view.getByLabelText(m.aiApiAddress()) as HTMLInputElement).value).toBe('https://x.top/v1')
		expect((view.getByLabelText(m.aiProxyKey()) as HTMLInputElement).type).toBe('password')
		expect(view.getByLabelText(m.llmModel())).toBeTruthy()
		const format = view.getByRole('radiogroup', { name: m.aiProxyFormat() })
		expect(format.querySelector('[aria-checked="true"]')?.textContent).toBe('OpenAI')
	})

	it('формат выставляется по адресу при вводе', () => {
		const { view, lastConnection } = renderAi({ platform: 'proxy', proxyBaseUrl: '', proxyFormat: 'openai' })
		fireEvent.change(view.getByLabelText(m.aiApiAddress()), { target: { value: 'https://x.top' } })
		expect(lastConnection()).toMatchObject({ proxyBaseUrl: 'https://x.top', proxyFormat: 'claude' })
		fireEvent.change(view.getByLabelText(m.aiApiAddress()), { target: { value: 'https://x.top/v1' } })
		expect(lastConnection()).toMatchObject({ proxyBaseUrl: 'https://x.top/v1', proxyFormat: 'openai' })
	})

	it('формат можно сменить вручную', () => {
		const { view, lastConnection } = renderAi({ platform: 'proxy', proxyBaseUrl: 'https://x.top/v1', proxyFormat: 'openai' })
		fireEvent.click(view.getByRole('radio', { name: 'Claude' }))
		expect(lastConnection()).toMatchObject({ proxyBaseUrl: 'https://x.top/v1', proxyFormat: 'claude', proxyFormatManual: true })
	})

	it('выбранный вручную формат не сбивается вводом адреса', () => {
		const { view, lastConnection } = renderAi({ platform: 'proxy', proxyBaseUrl: 'https://x.top', proxyFormat: 'claude', proxyFormatManual: true })
		fireEvent.change(view.getByLabelText(m.aiApiAddress()), { target: { value: 'https://x.top/v1' } })
		expect(lastConnection()).toMatchObject({ proxyBaseUrl: 'https://x.top/v1', proxyFormat: 'claude', proxyFormatManual: true })
	})

	it('очистка адреса снимает ручной выбор, следующий адрес снова определяет формат', () => {
		const manual = { ...DEFAULT_AI.connection, platform: 'proxy' as const, proxyBaseUrl: 'https://x.top', proxyFormat: 'claude' as const, proxyFormatManual: true }
		const cleared = { ...manual, ...proxyAddressPatch(manual, '') }
		expect(cleared).toMatchObject({ proxyBaseUrl: '', proxyFormatManual: false })
		expect(proxyAddressPatch(cleared, 'https://y.top/v1')).toMatchObject({ proxyFormat: 'openai' })
	})

	it('при смене формата пример модели другого формата очищается, своя модель остаётся', () => {
		const base = { ...DEFAULT_AI.connection, platform: 'proxy' as const, proxyFormat: 'openai' as const }
		expect(proxyFormatPatch({ ...base, model: defaultModel('openai') }, 'claude')).toEqual({ proxyFormat: 'claude', model: '', proxyFormatManual: true })
		expect(proxyAddressPatch({ ...base, model: defaultModel('openai') }, 'https://x.top')).toMatchObject({ proxyFormat: 'claude', model: '' })
		expect(proxyFormatPatch({ ...base, model: 'vendor/my-model' }, 'claude')).toEqual({ proxyFormat: 'claude', proxyFormatManual: true })
		expect(proxyFormatPatch({ ...base, model: '' }, 'claude')).toEqual({ proxyFormat: 'claude', proxyFormatManual: true })
	})

	it('предупреждает об адресе без https, кроме этого компьютера', () => {
		const proxyView = renderAi({ platform: 'proxy', proxyBaseUrl: 'http://x.top/v1' }).view
		expect(proxyView.getByText(m.aiInsecureAddress())).toBeTruthy()
		cleanup()
		expect(renderAi({ platform: 'proxy', proxyBaseUrl: 'https://x.top/v1' }).view.queryByText(m.aiInsecureAddress())).toBeNull()
		cleanup()
		expect(renderAi({ platform: 'proxy', proxyBaseUrl: 'http://localhost:8080/v1' }).view.queryByText(m.aiInsecureAddress())).toBeNull()
		cleanup()
		expect(renderAi({ platform: 'claude', claudeBaseUrl: 'http://x.top' }).view.getByText(m.aiInsecureAddress())).toBeTruthy()
	})

	it('адрес Claude можно очистить', () => {
		const { view, lastConnection } = renderAi({ platform: 'claude' })
		fireEvent.change(view.getByLabelText(m.aiApiAddress()), { target: { value: '' } })
		expect(lastConnection().claudeBaseUrl).toBe('')
	})

	it('ключ прокси пишется в своё поле, не в ключи других платформ', () => {
		const { view, lastConnection } = renderAi({ platform: 'proxy' })
		fireEvent.change(view.getByLabelText(m.aiProxyKey()), { target: { value: 'fake' } })
		expect(lastConnection()).toMatchObject({ proxyApiKey: 'fake', claudeApiKey: '', openaiApiKey: '' })
	})

	it('у Claude есть поле «Адрес API» с официальным адресом', () => {
		const { view, lastConnection } = renderAi({ platform: 'claude' })
		const input = view.getByLabelText(m.aiApiAddress()) as HTMLInputElement
		expect(input.value).toBe('https://api.anthropic.com')
		fireEvent.change(input, { target: { value: 'https://x.top' } })
		expect(lastConnection()).toMatchObject({ claudeBaseUrl: 'https://x.top' })
	})
})
