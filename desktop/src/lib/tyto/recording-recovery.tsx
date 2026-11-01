import * as dialog from '@tauri-apps/plugin-dialog'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { usePreferenceProvider } from '~/providers/preference'
import { recordingsFolder } from './media-path'
import { discardRecording, listUnfinishedRecordings, NOTHING_TO_RECOVER, recoverRecording, type UnfinishedRecording } from './screen-recording'

function startedOn(startedAt: string): string {
	const date = new Date(startedAt)
	if (Number.isNaN(date.getTime())) return startedAt
	try {
		return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long', timeStyle: 'short' }).format(date)
	} catch {
		return date.toLocaleString()
	}
}

/** `true`: stop asking for now (the person chose «Позже» or closed the question). */
async function ask(item: UnfinishedRecording): Promise<boolean> {
	const restore = m.tytoRecoveryRestore()
	const discard = m.tytoRecoveryDiscard()
	const answer = await dialog.message(m.tytoRecoveryBody({ date: startedOn(item.startedAt) }), {
		title: m.tytoRecoveryTitle(),
		kind: 'warning',
		// The first button answers Enter: the safe one, that keeps the recording.
		buttons: { yes: restore, no: discard, cancel: m.tytoRecoveryLater() },
	})
	// Custom buttons answer with their label on some platforms and with Yes/No on others.
	if (answer === 'Yes' || answer === restore) {
		try {
			// The project appears from `recording_finished { recovered: true }`.
			await recoverRecording(item.dir)
		} catch (error) {
			console.error('failed to recover a recording:', error)
			const message = String(error)
			if (message.startsWith(NOTHING_TO_RECOVER)) toast.warning(m.tytoRecoveryEmpty(), { position: 'bottom-center' })
			else toast.error(m.tytoRecoveryFailed(), { description: message, position: 'bottom-center' })
		}
		return false
	}
	if (answer === 'No' || answer === discard) {
		try {
			await discardRecording(item.dir)
		} catch (error) {
			console.error('failed to delete a recording:', error)
			toast.error(m.tytoRecoveryDiscardFailed(), { description: String(error), position: 'bottom-center' })
		}
		return false
	}
	return true
}

/**
 * At startup, asks about every recording a crash left in `<projects>/Записи/`, one at a time:
 * «Восстановить» saves it, «Удалить» drops it, «Позже» asks again at the next start.
 * Mount once.
 */
export function useRecordingRecovery(): void {
	const { projectsPath } = usePreferenceProvider()
	const projectsPathRef = useRef(projectsPath)
	const started = useRef(false)

	useEffect(() => {
		projectsPathRef.current = projectsPath
	}, [projectsPath])

	useEffect(() => {
		if (started.current) return
		started.current = true
		void (async () => {
			try {
				const found = await listUnfinishedRecordings(await recordingsFolder(projectsPathRef.current))
				for (const item of found) {
					if (await ask(item)) return
				}
			} catch (error) {
				console.warn('failed to look for unfinished recordings:', error)
			}
		})()
	}, [])
}
