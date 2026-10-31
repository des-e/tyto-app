// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({ present: new Set<string>() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null), convertFileSrc: (path: string) => `asset://${path}` }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => 'E:/moved/plan.mp4'), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(async (path: string) => disk.present.has(path)) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('~/lib/playback-rate', () => ({ usePlaybackRate: () => ({ playbackRate: 1, cyclePlaybackRate: vi.fn() }) }))
vi.mock('~/lib/transcripts-store', () => ({
	updateTranscriptMedia: vi.fn(async () => true),
	notifyTranscriptsChanged: vi.fn(),
}))

const session = vi.hoisted(() => ({ value: { queue: { relinkMedia: vi.fn() } } }))
vi.mock('~/pages/main/session', () => ({ useSession: () => session.value }))

import * as dialog from '@tauri-apps/plugin-dialog'
import { TooltipProvider } from '~/components/ui/tooltip'
import { audioExtensions, videoExtensions } from '~/lib/config'
import type { Segment } from '~/lib/transcript'
import { updateTranscriptMedia } from '~/lib/transcripts-store'
import PlayerBar from '~/pages/main/components/player-bar'
import { setLocale } from '~/paraglide/runtime.js'

const segments: Segment[] = [
	{ start: 0, stop: 2400, text: 'Начнем с поставок', speaker: 0 },
	{ start: 2400, stop: 5100, text: 'Сроки сдвигаются', speaker: 1 },
]

function makeJob() {
	return {
		id: 'j',
		name: 'Планерка',
		path: 'D:/zoom/plan.mp4',
		status: 'done',
		progress: 100,
		segments,
		savedPath: '/p/plan/transcript.vibe.json',
		hydrated: true,
	}
}

function renderPlayer(job: ReturnType<typeof makeJob>) {
	return render(
		<TooltipProvider>
			<PlayerBar job={job as never} />
		</TooltipProvider>,
	)
}

beforeAll(() => setLocale('ru-RU', { reload: false }))

beforeEach(() => {
	disk.present.clear()
	vi.clearAllMocks()
})

afterEach(cleanup)

describe('пропавший файл записи', () => {
	it('нет файла: видна «Файл не найден» и «Указать файл», реплики остаются', async () => {
		const job = makeJob()
		renderPlayer(job)
		expect(await screen.findByText('Файл не найден')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Указать файл' })).toBeTruthy()
		// The timeline gives way to the notice; the transcript itself is untouched.
		expect(screen.queryByRole('slider')).toBeNull()
		expect(job.segments).toBe(segments)
		expect(job.segments.map((segment) => segment.text)).toEqual(['Начнем с поставок', 'Сроки сдвигаются'])
	})

	it('файл на месте: шкала, без «Файл не найден»', async () => {
		disk.present.add('D:/zoom/plan.mp4')
		renderPlayer(makeJob())
		await vi.waitFor(() => expect(screen.getByRole('slider')).toBeTruthy())
		expect(screen.queryByText('Файл не найден')).toBeNull()
	})

	it('«Указать файл» обновляет запись проекта и путь в очереди', async () => {
		renderPlayer(makeJob())
		fireEvent.click(await screen.findByRole('button', { name: 'Указать файл' }))
		await vi.waitFor(() => expect(session.value.queue.relinkMedia).toHaveBeenCalledWith('j', 'E:/moved/plan.mp4'))
		expect(vi.mocked(updateTranscriptMedia)).toHaveBeenCalledWith('/p/plan/transcript.vibe.json', 'E:/moved/plan.mp4')
		const options = vi.mocked(dialog.open).mock.calls[0]?.[0]
		expect(options?.filters?.[0]?.extensions).toEqual(expect.arrayContaining([...videoExtensions, ...audioExtensions]))
	})

	it('выбор отменен: ничего не меняется', async () => {
		vi.mocked(dialog.open).mockResolvedValueOnce(null)
		renderPlayer(makeJob())
		fireEvent.click(await screen.findByRole('button', { name: 'Указать файл' }))
		await vi.waitFor(() => expect(vi.mocked(dialog.open)).toHaveBeenCalled())
		expect(session.value.queue.relinkMedia).not.toHaveBeenCalled()
		expect(vi.mocked(updateTranscriptMedia)).not.toHaveBeenCalled()
	})
})
