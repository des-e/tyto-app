import * as dialog from '@tauri-apps/plugin-dialog'
import { FileQuestion } from 'lucide-react'
import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { audioExtensions, videoExtensions } from '~/lib/config'
import { notifyTranscriptsChanged, updateTranscriptMedia } from '~/lib/transcripts-store'
import type { Job } from '~/pages/main/hooks/use-transcribe-queue'
import { useSession } from '~/pages/main/session'

const mediaExtensions = [...videoExtensions, ...audioExtensions]

/**
 * Stands in for the player timeline when the project's media file is gone (moved, renamed, on an
 * unplugged drive). The transcript stays readable; «Указать файл» points the project at the file's
 * new place.
 */
export function MissingMedia({ job }: { job: Job }) {
	const { queue } = useSession()

	async function pick() {
		let picked: string | null = null
		try {
			const selected = await dialog.open({ multiple: false, directory: false, filters: [{ name: '', extensions: mediaExtensions }] })
			picked = typeof selected === 'string' ? selected : null
		} catch (error) {
			console.warn('failed to pick the media file:', error)
		}
		if (!picked) return
		if (job.savedPath && (await updateTranscriptMedia(job.savedPath, picked))) notifyTranscriptsChanged()
		queue.relinkMedia(job.id, picked)
	}

	return (
		<div className="flex min-w-0 flex-1 items-center gap-3" role="status">
			<FileQuestion className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
			<span className="truncate text-[13px] text-muted-foreground">{m.tytoMediaMissing()}</span>
			<Button variant="secondary" size="sm" onClick={() => void pick()} className="shrink-0">
				{m.tytoMediaPick()}
			</Button>
		</div>
	)
}
