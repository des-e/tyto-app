import { Pencil } from 'lucide-react'
import { useRef, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { speakerName, type SpeakerNames } from '~/lib/transcript'
import { cn } from '~/lib/style'
import { SpeakerMark } from '~/lib/tyto/speaker-mark'

/** «7 участников»: the plural form comes from the locale's rules, the words from the messages. */
export function participantsLabel(count: number) {
	const form = new Intl.PluralRules(getLocale()).select(count)
	const value = { count: String(count) }
	if (form === 'one') return m.transcriptParticipantsOne(value)
	if (form === 'few') return m.transcriptParticipantsFew(value)
	return m.transcriptParticipantsMany(value)
}

/** One row of the list: the name, and a field in its place while it is being renamed. */
function ParticipantRow({
	speaker,
	speakerNames,
	editable,
	onRename,
}: {
	speaker: number
	speakerNames?: SpeakerNames
	editable: boolean
	onRename: (speaker: number, name: string) => void
}) {
	const chosen = speakerNames?.[speaker]
	const label = speakerName(speaker, m.speakerPrefix(), speakerNames)
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState('')
	// Escape throws the draft away; Enter and leaving the field keep it.
	const cancelled = useRef(false)

	function start() {
		cancelled.current = false
		setDraft(chosen ?? '')
		setEditing(true)
	}

	function finish() {
		if (!cancelled.current && draft.trim() !== (chosen ?? '')) onRename(speaker, draft.trim())
		setEditing(false)
	}

	if (editing)
		return (
			<div className="flex h-8 items-center gap-2.5 px-2">
				<SpeakerMark speaker={speaker} name={draft || chosen} />
				<input
					autoFocus
					value={draft}
					aria-label={m.renameSpeaker()}
					placeholder={`${m.speakerPrefix()} ${speaker + 1}`}
					onChange={(event) => setDraft(event.target.value.slice(0, 64))}
					onBlur={finish}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault()
							event.currentTarget.blur()
						}
						if (event.key === 'Escape') {
							// The popover stays open: Escape leaves only the field.
							event.preventDefault()
							event.stopPropagation()
							cancelled.current = true
							event.currentTarget.blur()
						}
					}}
					className="h-7 min-w-0 flex-1 rounded-[var(--tyto-r-sm)] border border-border bg-background px-2 text-[13.5px] text-foreground outline-none focus:border-foreground/40"
				/>
			</div>
		)

	return (
		<button
			type="button"
			disabled={!editable}
			onClick={start}
			title={editable ? m.renameSpeaker() : undefined}
			className="group flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-[var(--tyto-r-sm)] px-2 text-start transition-colors duration-150 hover:bg-[var(--tyto-line-active)] disabled:cursor-default disabled:hover:bg-transparent">
			<SpeakerMark speaker={speaker} name={chosen} />
			<span className={cn('min-w-0 flex-1 truncate text-[13.5px]', chosen ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
			{editable && <Pencil aria-hidden className="h-3 w-3 shrink-0 text-[var(--tyto-faint)] group-hover:text-foreground" />}
		</button>
	)
}

/**
 * The «N участников» plate under the title (design round 3): up to three overlapping badges and the
 * count; a click opens the list, where a click on a name renames that speaker across the text.
 */
export function ParticipantsButton({
	speakers,
	speakerNames,
	editable,
	onRename,
}: {
	speakers: number[]
	speakerNames?: SpeakerNames
	editable: boolean
	onRename: (speaker: number, name: string) => void
}) {
	if (speakers.length === 0) return null
	const label = participantsLabel(speakers.length)

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="flex h-6 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background ps-1 pe-2 text-[12.5px] text-foreground transition-colors duration-150 hover:bg-[var(--tyto-line-active)] focus-visible:outline-2 focus-visible:outline-foreground">
					<span className="tyto-people-faces">
						{speakers.slice(0, 3).map((speaker) => (
							<SpeakerMark key={speaker} speaker={speaker} name={speakerNames?.[speaker]} />
						))}
					</span>
					{label}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[260px] rounded-[12px] p-1.5" aria-label={label}>
				<p className="px-2 pt-1.5 pb-2 text-[12px] font-medium text-muted-foreground">{label}</p>
				<ul className="max-h-[320px] overflow-y-auto">
					{speakers.map((speaker) => (
						<li key={speaker}>
							<ParticipantRow speaker={speaker} speakerNames={speakerNames} editable={editable} onRename={onRename} />
						</li>
					))}
				</ul>
				{editable && <p className="mx-2 mt-1.5 mb-1 text-[12px] leading-[1.45] text-muted-foreground">{m.transcriptParticipantsHint()}</p>}
			</PopoverContent>
		</Popover>
	)
}
