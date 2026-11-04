// @vitest-environment jsdom

import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({}))
vi.mock('@tauri-apps/plugin-dialog', () => ({}))
vi.mock('@tauri-apps/plugin-fs', () => ({}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('~/pages/settings/view-model', () => ({ viewModel: () => ({ appVersion: 'v0', appVersionNumber: '0', preference: {} }) }))
vi.mock('~/pages/settings/sections/general', () => ({ GeneralSection: () => null }))

import { TooltipProvider } from '~/components/ui/tooltip'
import { m } from '~/paraglide/messages.js'
import SettingsPage from '~/pages/settings/page'
import { ActionRow, SettingsField, SettingsGroup, SettingsRow } from '~/pages/settings/sections/shared'

afterEach(cleanup)

function renderPage() {
	return render(
		<TooltipProvider>
			<SettingsPage setVisible={vi.fn()} />
		</TooltipProvider>,
	)
}

describe('Tyto: настройки строками', () => {
	it('меню сгруппировано «Расшифровка / Запись и голос / Дополнительно»', () => {
		const view = renderPage()
		const nav = view.getByRole('navigation', { name: m.settings() })
		const headings = Array.from(nav.querySelectorAll('[data-settings-group]')).map((el) => el.textContent)
		expect(headings).toEqual([m.settingsGroupTranscription(), m.settingsGroupRecording(), m.settingsGroupMore()])
	})

	it('разделы разложены по группам', () => {
		const view = renderPage()
		const nav = view.getByRole('navigation', { name: m.settings() })
		const groups = Array.from(nav.querySelectorAll('[data-group]')).map((el) => ({
			title: el.querySelector('[data-settings-group]')?.textContent ?? null,
			items: within(el as HTMLElement)
				.queryAllByRole('button')
				.map((b) => b.textContent),
		}))
		expect(groups).toEqual([
			{ title: null, items: [m.general(), m.privacy()] },
			{ title: m.settingsGroupTranscription(), items: [m.transcription(), m.navModels(), m.navTuning()] },
			{ title: m.settingsGroupRecording(), items: [m.recordingSettings(), m.navDictation()] },
			{ title: m.settingsGroupMore(), items: [m.aiSection(), m.navAgents(), m.navAdvanced()] },
		])
	})

	it('пункты меню без иконок', () => {
		const view = renderPage()
		const nav = view.getByRole('navigation', { name: m.settings() })
		expect(nav.querySelectorAll('button svg').length).toBe(0)
	})

	it('телефон по-прежнему скрыт флагом', () => {
		const view = renderPage()
		expect(view.queryByText(m.phone())).toBeNull()
	})

	it('группа — белая карточка с заголовком над ней (вариант B), строки без своих карточек', () => {
		const view = render(
			<SettingsGroup title="Группа">
				<SettingsRow label="Строка" description="Описание" />
				<SettingsField label="Поле">
					<input />
				</SettingsField>
				<ActionRow label="Действие" />
			</SettingsGroup>,
		)
		expect(view.getByText('Группа').className).toContain('tyto-settings-group-title')
		const card = view.container.querySelector('.tyto-settings-group-card') as HTMLElement
		expect(card).not.toBeNull()
		const row = view.getByText('Строка').closest('div[class*="min-h-"]') as HTMLElement
		expect(row.parentElement).toBe(card)
		expect(row.className).toContain('min-h-[56px]')
		// Side padding comes from the card rule in theme.css, not from each row.
		expect(row.className).not.toMatch(/\bpx-4\b/)
	})
})
