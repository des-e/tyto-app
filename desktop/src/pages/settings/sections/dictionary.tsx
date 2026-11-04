import { X } from 'lucide-react'
import { useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { dictionaryRoom, parseDictionary, serializeDictionary, wordsLabel } from '~/lib/tyto/dictionary'
import { SettingsGroup, SettingsNote, rowControlClass, type SettingsViewModel } from './shared'

/**
 * «Словарь» (design round 8): the words Tyto should spell exactly, as chips with a field to add one
 * and a way to paste a whole list. They are Whisper's initial prompt underneath (lib/tyto/dictionary.ts).
 */
export function DictionarySection({ vm }: { vm: SettingsViewModel }) {
	const options = vm.preference.modelOptions
	const words = parseDictionary(options.init_prompt)
	const room = dictionaryRoom(words)
	const [draft, setDraft] = useState('')
	const [pasting, setPasting] = useState(false)
	const [list, setList] = useState('')

	function save(next: string[]) {
		vm.preference.setModelOptions({ ...options, init_prompt: serializeDictionary(next) })
	}

	function add(text: string) {
		const added = parseDictionary(text)
		if (added.length) save([...words, ...added])
	}

	return (
		<div className="space-y-6">
			<p className="max-w-[560px] text-[13.5px] leading-[1.55] text-muted-foreground">{m.dictIntro()}</p>

			<SettingsGroup>
				<form
					className="flex gap-2 py-3"
					onSubmit={(event) => {
						event.preventDefault()
						add(draft)
						setDraft('')
					}}>
					<Input
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder={m.dictNewWord()}
						aria-label={m.dictNewWord()}
						className={`flex-1 ${rowControlClass}`}
					/>
					<Button type="submit" variant="outline" size="sm" className="h-9" disabled={!draft.trim()}>
						{m.dictAdd()}
					</Button>
				</form>

				{words.length > 0 && (
					<ul aria-label={m.setDictionary()} className="flex flex-wrap gap-1.5 py-3">
						{words.map((word) => (
							<li key={word} className="tyto-dict-chip">
								{word}
								<button type="button" aria-label={m.dictRemove({ word })} onClick={() => save(words.filter((other) => other !== word))}>
									<X aria-hidden className="h-3 w-3" />
								</button>
							</li>
						))}
					</ul>
				)}

				<div className="flex items-center justify-between gap-4 py-3 text-xs text-muted-foreground">
					<span>
						{wordsLabel(words.length)} · {room.more > 0 ? m.dictRoom({ count: String(room.more) }) : m.dictFull()}
					</span>
					{!pasting && (
						<Button variant="ghost" size="sm" onClick={() => setPasting(true)}>
							{m.dictPaste()}
						</Button>
					)}
				</div>

				{pasting && (
					<div className="space-y-2 py-3">
						<Textarea
							autoFocus
							value={list}
							onChange={(event) => setList(event.target.value)}
							placeholder={m.dictPasteHint()}
							aria-label={m.dictPaste()}
							className="min-h-24 resize-none rounded-lg text-sm"
						/>
						<div className="flex justify-end gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									setPasting(false)
									setList('')
								}}>
								{m.dictCancel()}
							</Button>
							<Button
								size="sm"
								disabled={!list.trim()}
								onClick={() => {
									add(list)
									setList('')
									setPasting(false)
								}}>
								{m.dictPasteAdd()}
							</Button>
						</div>
					</div>
				)}

				{vm.preference.modelMetadata?.capabilities.text_prompts === false && words.length > 0 && (
					<SettingsNote>{m.promptIgnoredByModel()}</SettingsNote>
				)}
			</SettingsGroup>
		</div>
	)
}
