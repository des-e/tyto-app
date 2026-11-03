import { FolderOpen, ListChecks, Lock, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { OwlMark } from './owl-mark'

export type EmptyPanel = 'none' | 'record' | 'link'

interface EmptyScreenProps {
	/** a file is being dragged over the window (the drop target is the whole window) */
	dragging: boolean
	/** a dropped or picked folder is being expanded */
	collectingFolder: boolean
	/** no saved projects yet: the welcome with three steps instead of the short labels */
	firstRun: boolean
	panel: EmptyPanel
	onBrowse: () => void
	onSelectPanel: (panel: EmptyPanel) => void
	/** the «Записать звонок» card (RecordCard) */
	recordCard: ReactNode
	/** the link panel, shown under the cards while «По ссылке» is open */
	linkContent?: ReactNode
	/** «Ждут расшифровки»: recordings saved without a transcript; null hides the block */
	waiting?: ReactNode
	/** language and «Еще настройки» (QuietRow), restyled as links */
	options: ReactNode
}

function Step({ index, title, body }: { index: number; title: string; body: string }) {
	return (
		<li className="tyto-home-step">
			<span aria-hidden className="tyto-home-step-index">
				{index}
			</span>
			<span>
				<span className="tyto-home-step-title">{title}</span>
				<span className="tyto-home-step-body">{body}</span>
			</span>
		</li>
	)
}

/**
 * The main screen with nothing open (design round C, 2026-11-03): the owl over a short greeting, two
 * cards (record a call; transcribe a file, which also takes the drop) and «Ждут расшифровки». A first
 * run (no projects yet) greets with three steps; afterwards three short labels say what Tyto does.
 * The whole right-hand area still takes a dropped file (theme.css `.tyto-home*`).
 */
export function EmptyScreen({ dragging, collectingFolder, firstRun, panel, onBrowse, onSelectPanel, recordCard, linkContent, waiting, options }: EmptyScreenProps) {
	const linkOpen = panel === 'link'

	return (
		<div data-testid="empty-screen" data-dragging={dragging} className="tyto-home">
			<div aria-hidden className="tyto-empty-drop" />

			<div className="tyto-home-inner">
				<header className="tyto-home-head">
					<OwlMark className="tyto-home-owl" />
					{firstRun ? (
						<>
							<h1 className="tyto-home-title">{m.tytoHomeWelcome()}</h1>
							<p className="tyto-home-lead">{m.tytoHomeWelcomeLead()}</p>
						</>
					) : (
						<>
							<h1 className="tyto-home-title">{m.tytoHomeTitle()}</h1>
							<ul className="tyto-home-labels">
								<li>
									<Lock aria-hidden strokeWidth={1.75} />
									{m.tytoHomeOffline()}
								</li>
								<li>
									<Users aria-hidden strokeWidth={1.75} />
									{m.tytoHomeSpeakers()}
								</li>
								<li>
									<ListChecks aria-hidden strokeWidth={1.75} />
									{m.tytoHomeSummary()}
								</li>
							</ul>
						</>
					)}
				</header>

				{firstRun && (
					<ol className="tyto-home-steps">
						<Step index={1} title={m.tytoHomeStep1Title()} body={m.tytoHomeStep1Body()} />
						<Step index={2} title={m.tytoHomeStep2Title()} body={m.tytoHomeStep2Body()} />
						<Step index={3} title={m.tytoHomeStep3Title()} body={m.tytoHomeStep3Body()} />
					</ol>
				)}

				<div className="tyto-home-cards">
					{recordCard}
					<section className="tyto-home-card tyto-home-card-drop" aria-labelledby="tyto-file-card-title">
						<div>
							<h2 id="tyto-file-card-title" className="tyto-home-card-title">
								{m.tytoFileCardTitle()}
							</h2>
							<p className="tyto-home-card-lead">{m.tytoFileCardDrop()}</p>
						</div>
						<div className="flex-1" />
						<div className="flex items-center gap-3">
							<Button variant="secondary" onClick={onBrowse} className="h-10 flex-1">
								{collectingFolder ? <Spinner /> : <FolderOpen />}
								{m.selectFile()}
							</Button>
							<Button variant="ghost" aria-expanded={linkOpen} onClick={() => onSelectPanel(linkOpen ? 'none' : 'link')} className="h-10 text-muted-foreground">
								{m.fromLink()}
							</Button>
						</div>
					</section>
				</div>

				{linkOpen && linkContent && <div className="tyto-home-panel">{linkContent}</div>}

				<div className="tyto-empty-options">
					<span>{m.meetingLanguage()}:</span>
					{options}
				</div>

				{waiting}
			</div>
		</div>
	)
}
