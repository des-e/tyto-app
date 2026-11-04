import { useId } from 'react'
import { m } from '~/paraglide/messages.js'
import type { TranscriptTab } from '~/pages/main/hooks/use-transcript-view'

interface TranscriptTabsProps {
	tab: TranscriptTab
	setTab: (tab: TranscriptTab) => void
	/** «Саммари» opens: a summary exists, or the AI can write one (opening the tab starts it). */
	summaryReady: boolean
	/** The summary came with topics, so «Темы» has something to show. */
	topicsReady?: boolean
}

/**
 * «Текст / Саммари / Темы» as text tabs with a 2 px rule under the active one, at the start of the
 * document toolbar (theme.css `.tyto-tab`). Stays visible while search is open. A tab with nothing
 * behind it is disabled and drawn fainter; «Темы» then explains through aria-describedby and a tooltip.
 */
export function TranscriptTabs({ tab, setTab, summaryReady, topicsReady = false }: TranscriptTabsProps) {
	const hintId = useId()
	const tabs: { value: TranscriptTab; label: string; disabled: boolean; hint?: string }[] = [
		{ value: 'transcript', label: m.segmentsTab(), disabled: false },
		{ value: 'summary', label: m.summaryTab(), disabled: !summaryReady && tab !== 'summary' },
		{ value: 'topics', label: m.topicsTab(), disabled: !topicsReady && tab !== 'topics', hint: topicsReady ? undefined : m.topicsComingSoon() },
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
						if (item.value !== tab) setTab(item.value)
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
