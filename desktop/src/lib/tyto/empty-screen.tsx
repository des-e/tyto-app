import { FolderOpen, Link2, Mic } from 'lucide-react'
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
	panel: EmptyPanel
	onBrowse: () => void
	onSelectPanel: (panel: EmptyPanel) => void
	/** the record or link panel, shown under the buttons while that source is chosen */
	panelContent?: ReactNode
	/** language and «Еще настройки» (QuietRow), restyled as links */
	options: ReactNode
}

/**
 * The empty main screen without the dashed card: the whole right-hand area takes the file, the owl,
 * «Перетащите запись встречи», three labelled buttons instead of icon tabs, the language as a link
 * and «Файлы не покидают компьютер» at the bottom (theme.css `.tyto-empty*`).
 */
export function EmptyScreen({ dragging, collectingFolder, panel, onBrowse, onSelectPanel, panelContent, options }: EmptyScreenProps) {
	const toggle = (next: EmptyPanel) => onSelectPanel(panel === next ? 'none' : next)

	return (
		<div data-testid="empty-screen" data-dragging={dragging} className="tyto-empty">
			<div aria-hidden className="tyto-empty-drop" />

			<OwlMark className="tyto-empty-owl" />
			<h1 className="tyto-title-screen tyto-empty-title">{m.dropFilesHere()}</h1>
			<p className="tyto-empty-lead">{m.orClickToBrowse()}</p>

			<div className="tyto-empty-actions">
				<Button variant="primary" size="lg" onClick={onBrowse}>
					{collectingFolder ? <Spinner /> : <FolderOpen />}
					{m.selectFile()}
				</Button>
				<Button variant="secondary" size="lg" aria-pressed={panel === 'record'} onClick={() => toggle('record')}>
					<Mic />
					{m.record()}
				</Button>
				<Button variant="ghost" size="lg" aria-pressed={panel === 'link'} onClick={() => toggle('link')}>
					<Link2 />
					{m.fromLink()}
				</Button>
			</div>

			{panel !== 'none' && panelContent && <div className="tyto-empty-panel">{panelContent}</div>}

			<div className="tyto-empty-options">
				<span>{m.meetingLanguage()}:</span>
				{options}
			</div>

			<p className="tyto-empty-local">{m.filesStayLocal()}</p>
		</div>
	)
}
