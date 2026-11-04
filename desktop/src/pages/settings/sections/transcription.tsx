import * as dialog from '@tauri-apps/plugin-dialog'
import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { m } from '~/paraglide/messages.js'
import { describeAutoExport } from './auto-export'
import LanguageInput from '~/components/language-input'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { parseDictionary, wordsLabel } from '~/lib/tyto/dictionary'
import { deleteAllTranscripts, listTranscripts, notifyTranscriptsChanged, TRANSCRIPTS_CHANGED_EVENT } from '~/lib/transcripts-store'
import { ActionRow, SettingsGroup, SettingsRow, type SettingsViewModel } from './shared'

/** Bulk cleanup for the projects folder: one row, one confirmation, everything Tyto saved goes. */
function DeleteAllProjectsRow({ projectsPath }: { projectsPath: string | null }) {
	const [count, setCount] = useState<number | null>(null)
	const [deleting, setDeleting] = useState(false)

	const refresh = useCallback(() => {
		void listTranscripts(projectsPath).then((entries) => setCount(entries.length))
	}, [projectsPath])

	useEffect(() => {
		refresh()
		// Saves and single-row deletes happen in the main window; both announce themselves.
		window.addEventListener(TRANSCRIPTS_CHANGED_EVENT, refresh)
		return () => window.removeEventListener(TRANSCRIPTS_CHANGED_EVENT, refresh)
	}, [refresh])

	async function deleteAll() {
		if (!count) return
		const confirmed = await dialog.ask(m.deleteAllProjectsBody({ count: String(count) }), { title: m.deleteAllProjects(), kind: 'warning' })
		if (!confirmed) return
		setDeleting(true)
		try {
			const { deleted, failed } = await deleteAllTranscripts(projectsPath)
			// The sidebar in the main window is listening — it drops the rows as soon as this fires.
			notifyTranscriptsChanged()
			refresh()
			toast.success(m.deleteAllProjectsDone({ count: String(deleted) }))
			if (failed) toast.error(m.deleteAllProjectsFailed({ count: String(failed) }))
		} finally {
			setDeleting(false)
		}
	}

	return (
		<ActionRow
			label={m.deleteAllProjects()}
			description={count ? m.deleteAllProjectsInfo({ count: String(count) }) : m.noProjectsYet()}
			icon={<Trash2 className="h-4 w-4" />}
			onClick={() => void deleteAll()}
			disabled={deleting || !count}
			destructive
			activateOnClick
		/>
	)
}

export function TranscriptionSection({
	vm,
	onOpenAutoExport,
	onOpenDictionary,
}: {
	vm: SettingsViewModel
	onOpenAutoExport: () => void
	onOpenDictionary: () => void
}) {
	const projectsPath = vm.preference.projectsPath ?? vm.defaultProjectsPath
	const autoExport = vm.preference.autoExport
	const words = parseDictionary(vm.preference.modelOptions.init_prompt)

	return (
		<div className="space-y-6">
			<SettingsGroup title={m.setGroupTranscription()}>
				<SettingsRow label={m.setDefaultLanguage()} description={m.setDefaultLanguageInfo()}>
					<div className="w-56">
						<LanguageInput variant="prominent" />
					</div>
				</SettingsRow>
				<SettingsRow label={m.setDiarize()} description={m.setDiarizeInfo()}>
					<Switch checked={vm.preference.diarizeEnabled} onCheckedChange={vm.toggleDiarization} aria-label={m.setDiarize()} />
				</SettingsRow>
				<SettingsRow
					label={m.setDictionary()}
					description={words.length ? `${wordsLabel(words.length)}: ${m.setDictionaryWhat()}` : m.setDictionaryEmpty()}>
					<Button variant="outline" size="sm" onClick={onOpenDictionary}>
						{m.setDictionaryOpen()}
					</Button>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup title={m.setGroupWhenDone()}>
				<SettingsRow label={m.setSound()}>
					<Switch checked={vm.preference.soundOnFinish} onCheckedChange={vm.preference.setSoundOnFinish} aria-label={m.setSound()} />
				</SettingsRow>
				<SettingsRow label={m.setFocus()}>
					<Switch checked={vm.preference.focusOnFinish} onCheckedChange={vm.preference.setFocusOnFinish} aria-label={m.setFocus()} />
				</SettingsRow>
				<SettingsRow label={m.setAutoSave()} description={autoExport.enabled ? describeAutoExport(autoExport) : m.autoExportInfo()}>
					<Button variant="outline" size="sm" onClick={onOpenAutoExport}>
						{m.setConfigure()}
					</Button>
					<Switch
						checked={autoExport.enabled}
						onCheckedChange={(enabled) => vm.preference.setAutoExport({ ...autoExport, enabled })}
						aria-label={m.setAutoSave()}
					/>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup title={m.projectsFolder()}>
				<SettingsRow
					label={
						<span title={projectsPath} className="block truncate font-mono text-xs text-muted-foreground">
							{projectsPath}
						</span>
					}>
					{vm.preference.projectsPath && (
						<Button variant="ghost" size="sm" onMouseDown={vm.resetProjectsPath}>
							{m.resetToDefault()}
						</Button>
					)}
					<Button variant="outline" size="sm" onMouseDown={vm.changeProjectsPath}>
						{m.changeProjectsFolder()}
					</Button>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup title={m.setDangerZone()}>
				<DeleteAllProjectsRow projectsPath={vm.preference.projectsPath} />
			</SettingsGroup>
		</div>
	)
}
