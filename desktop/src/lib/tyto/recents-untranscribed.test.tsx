// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null), convertFileSrc: (path: string) => `asset://${path}` }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(async () => true), message: vi.fn(async () => 'Yes') }))
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(async () => true) }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('~/lib/app', () => ({ openSettingsSection: vi.fn() }))
vi.mock('~/lib/logs', () => ({ getVersionNumber: vi.fn(async () => '0.1.0') }))
vi.mock('~/pages/main/components/retranscribe-dialog', () => ({ default: () => null }))

const store = vi.hoisted(() => ({
	entries: [] as { path: string; name: string; createdAt: Date }[],
	records: {} as Record<string, { name: string; sourcePath: string; createdAt: string; segments: unknown[]; durationSeconds?: number }>,
}))

vi.mock('~/lib/transcripts-store', () => ({
	listTranscripts: vi.fn(async () => store.entries),
	readTranscript: vi.fn(async (path: string) => store.records[path] ?? null),
	deleteTranscript: vi.fn(async () => true),
	renameTranscript: vi.fn(async () => null),
	resolveProjectAudio: vi.fn(async () => null),
	TRANSCRIPTS_CHANGED_EVENT: 'transcripts-changed',
	TRANSCRIPT_FILENAME: 'transcript.vibe.json',
}))

const session = vi.hoisted(() => ({
	value: {
		queue: { jobs: [] as unknown[], selectedJob: null as unknown, selectedId: null as string | null, running: false, selectJob: () => {}, hydrate: () => {}, enqueue: () => {} },
		startNew: () => {},
		preference: { projectsPath: '' },
	},
}))
vi.mock('~/pages/main/session', () => ({ useSession: () => session.value }))

import * as dialog from '@tauri-apps/plugin-dialog'
import { TooltipProvider } from '~/components/ui/tooltip'
import { deleteTranscript } from '~/lib/transcripts-store'
import RecentsSidebar from '~/pages/main/components/recents-sidebar'
import { setLocale } from '~/paraglide/runtime.js'

const today = (hours: number, minutes: number) => {
	const date = new Date()
	date.setHours(hours, minutes, 0, 0)
	return date
}

const SCREEN = 'C:\\Users\\D\\Documents\\Tyto\\Экран-20261031-100200\\transcript.vibe.json'
const DROPPED = 'C:\\Users\\D\\Documents\\Tyto\\Созвон-20261031-091500\\transcript.vibe.json'

beforeAll(() => {
	setLocale('ru-RU', { reload: false })
	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 800 })
	Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 248 })
})

beforeEach(() => {
	store.entries = [
		{ path: SCREEN, name: 'Запись экрана', createdAt: today(10, 2) },
		{ path: DROPPED, name: 'Созвон с подрядчиком', createdAt: today(9, 15) },
	]
	store.records = {
		[SCREEN]: { name: 'Запись экрана', sourcePath: 'c:/users/d/documents/tyto/Записи/screen.mp4', createdAt: '', segments: [], durationSeconds: 48 * 60 },
		[DROPPED]: {
			name: 'Созвон с подрядчиком',
			sourcePath: 'D:\\zoom\\meet.mp4',
			createdAt: '',
			segments: [{ start: 0, stop: 22 * 60 * 100, text: 'Начнем' }],
		},
	}
	vi.clearAllMocks()
})

afterEach(cleanup)

function renderSidebar() {
	return render(
		<TooltipProvider>
			<RecentsSidebar />
		</TooltipProvider>,
	)
}

function rowOf(text: string) {
	const row = screen.getByText(text).closest('.tyto-recent')
	if (!row) throw new Error(`no row for ${text}`)
	return row as HTMLElement
}

async function deleteRow(name: string) {
	await screen.findByText(name)
	const trigger = within(rowOf(name)).getByRole('button', { name: 'Действия с расшифровкой' })
	fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
	fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }))
}

describe('записи без расшифровки и удаление с файлом', () => {
	it('проект без реплик: точка «Не расшифровано» в строке, длительность из durationSeconds в подсказке', async () => {
		renderSidebar()
		expect(await screen.findByRole('img', { name: 'Не расшифровано' })).toBeTruthy()
		const title = (name: string) => rowOf(name).querySelector('button')?.getAttribute('title')
		await waitFor(() => expect(title('Запись экрана')).toBe('Запись экрана\n10:02 · 48 мин · Не расшифровано'))
		await waitFor(() => expect(title('Созвон с подрядчиком')).toBe('Созвон с подрядчиком\n09:15 · 22 мин'))
		expect(within(rowOf('Созвон с подрядчиком')).getByText('09:15')).toBeTruthy()
	})

	it('удаление записи из Записи/ спрашивает про файл: «Удалить с файлом» → deleteMedia: true', async () => {
		vi.mocked(dialog.message).mockResolvedValueOnce('Удалить с файлом')
		renderSidebar()
		await deleteRow('Запись экрана')
		await vi.waitFor(() => expect(vi.mocked(deleteTranscript)).toHaveBeenCalledWith(SCREEN, { deleteMedia: true }))
		expect(vi.mocked(dialog.message)).toHaveBeenCalledWith('Удалить и файл записи?', {
			title: 'Удалить расшифровку',
			kind: 'warning',
			// Enter answers the first button: it keeps the file.
			buttons: { yes: 'Оставить файл', no: 'Удалить с файлом', cancel: 'Отмена' },
		})
		expect(vi.mocked(dialog.ask)).not.toHaveBeenCalled()
	})

	it('ответ Yes (Enter, первая кнопка) оставляет файл, No удаляет с файлом', async () => {
		vi.mocked(dialog.message).mockResolvedValueOnce('Yes')
		renderSidebar()
		await deleteRow('Запись экрана')
		await vi.waitFor(() => expect(vi.mocked(deleteTranscript)).toHaveBeenCalledWith(SCREEN, { deleteMedia: false }))
		cleanup()

		vi.mocked(deleteTranscript).mockClear()
		vi.mocked(dialog.message).mockResolvedValueOnce('No')
		renderSidebar()
		await deleteRow('Запись экрана')
		await vi.waitFor(() => expect(vi.mocked(deleteTranscript)).toHaveBeenCalledWith(SCREEN, { deleteMedia: true }))
	})

	it('«Оставить файл» удаляет проект без файла, «Отмена» ничего не удаляет', async () => {
		vi.mocked(dialog.message).mockResolvedValueOnce('Оставить файл')
		renderSidebar()
		await deleteRow('Запись экрана')
		await vi.waitFor(() => expect(vi.mocked(deleteTranscript)).toHaveBeenCalledWith(SCREEN, { deleteMedia: false }))
		cleanup()

		vi.mocked(deleteTranscript).mockClear()
		vi.mocked(dialog.message).mockResolvedValueOnce('Cancel')
		renderSidebar()
		await deleteRow('Запись экрана')
		await vi.waitFor(() => expect(vi.mocked(dialog.message)).toHaveBeenCalledTimes(2))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(vi.mocked(deleteTranscript)).not.toHaveBeenCalled()
	})

	it('удаление проекта с перетащенным видео вне Записи/ про файл не спрашивает и файл не трогает', async () => {
		renderSidebar()
		await deleteRow('Созвон с подрядчиком')
		await vi.waitFor(() => expect(vi.mocked(deleteTranscript)).toHaveBeenCalledWith(DROPPED, { deleteMedia: false }))
		expect(vi.mocked(dialog.ask)).toHaveBeenCalledExactlyOnceWith('Удалить «Созвон с подрядчиком»? Исходный файл останется на месте.', {
			title: 'Удалить расшифровку',
			kind: 'warning',
		})
		expect(vi.mocked(dialog.message)).not.toHaveBeenCalled()
	})
})
