// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({}))
vi.mock('@tauri-apps/plugin-dialog', () => ({}))
vi.mock('@tauri-apps/plugin-fs', () => ({}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('~/lib/app', () => ({ openSettingsSection: vi.fn() }))
vi.mock('~/lib/transcripts-store', () => ({
	listTranscripts: vi.fn(async () => []),
	TRANSCRIPTS_CHANGED_EVENT: 'transcripts-changed',
}))
vi.mock('~/pages/main/session', () => ({
	useSession: () => ({ queue: { jobs: [], selectedJob: null, selectedId: null, running: false }, startNew: vi.fn(), preference: { projectsPath: '' } }),
}))
vi.mock('~/pages/settings/view-model', () => ({ viewModel: () => ({ appVersion: 'v0', appVersionNumber: '0', preference: {} }) }))
// The default section is irrelevant here; its own dependencies are heavy.
vi.mock('~/pages/settings/sections/general', () => ({ GeneralSection: () => null }))

import { TooltipProvider } from '~/components/ui/tooltip'
import { m } from '~/paraglide/messages.js'
import RecentsSidebar from '~/pages/main/components/recents-sidebar'
import SettingsPage from '~/pages/settings/page'
import { PrivacySection } from '~/pages/settings/sections/privacy'

afterEach(cleanup)

describe('Tyto v1: скрытые функции', () => {
	it('настройки: нет раздела «Телефон»', () => {
		const view = render(
			<TooltipProvider>
				<SettingsPage setVisible={vi.fn()} />
			</TooltipProvider>,
		)
		expect(view.queryByText(m.phone())).toBeNull()
	})

	it('боковая панель: нет кнопки телефона', () => {
		const view = render(
			<TooltipProvider>
				<RecentsSidebar />
			</TooltipProvider>,
		)
		expect(view.queryByLabelText(m.phone())).toBeNull()
	})

	it('конфиденциальность: нет переключателя аналитики', () => {
		const vm = { preference: { analyticsEnabled: true, setAnalyticsEnabled: vi.fn(), saveTranscripts: true, setSaveTranscripts: vi.fn() } }
		const view = render(<PrivacySection vm={vm as never} />)
		expect(view.queryByText(m.analyticsEnabled())).toBeNull()
		expect(view.queryByText(m.saveProjects())).not.toBeNull()
	})
})
