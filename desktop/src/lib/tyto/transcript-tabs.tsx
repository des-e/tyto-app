import { useId } from 'react'
import { m } from '~/paraglide/messages.js'
import type { TranscriptTab } from '~/pages/main/hooks/use-transcript-view'

interface TranscriptTabsProps {
	tab: TranscriptTab
	setTab: (tab: TranscriptTab) => void
	/** a summary exists (or is on screen already) */
	summaryReady: boolean
}

/**
 * «Текст / Сводка / Темы» as text tabs with a 2 px rule under the active one, at the start of the
 * document toolbar (theme.css `.tyto-tab`). Stays visible while search is open. «Темы» is a
 * placeholder for topics with timecodes: disabled tabs are drawn fainter than inactive ones, its hint is announced
 * through aria-describedby and shown as a tooltip.
 */
export function TranscriptTabs({ tab, setTab, summaryReady }: TranscriptTabsProps) {
	const hintId = useId()
	const tabs: { value: TranscriptTab | 'topics'; label: string; disabled: boolean; hint?: string }[] = [
		{ value: 'transcript', label: m.segmentsTab(), disabled: false },
		{ value: 'summary', label: m.summaryTab(), disabled: !summaryReady && tab !== 'summary' },
		{ value: 'topics', label: m.topicsTab(), disabled: true, hint: m.topicsComingSoon() },
	]

	return (
		<div role="tablist" aria-label={m.transcriptTabs()} className="tyto-tabs">
			{tabs.map((item) => (
				<button
					key={item.value}
					type="button"
					role="tab"
					aria-selected={tab === item.value}
					disabled={item.disabled}
					aria-describedby={item.hint ? hintId : undefined}
					title={item.hint}
					onClick={() => {
						if (item.value !== 'topics' && item.value !== tab) setTab(item.value)
					}}
					className="tyto-tab">
					{item.label}
				</button>
			))}
			<span id={hintId} hidden>
				{m.topicsComingSoon()}
			</span>
		</div>
	)
}
