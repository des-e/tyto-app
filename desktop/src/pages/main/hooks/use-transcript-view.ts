import { CONFIG_KEYS } from '~/lib/config-keys'
import { usePersisted } from '~/lib/config-store'

export type TranscriptTextSize = 'sm' | 'md' | 'lg'

/**
 * What fills the page: the text (with the summary and topics around it, see the options), or the AI
 * review in its place.
 */
export type TranscriptTab = 'transcript' | 'review'

export interface TranscriptViewOptions {
	textSize: TranscriptTextSize
	setTextSize: (size: TranscriptTextSize) => void
	showTimestamps: boolean
	setShowTimestamps: (value: boolean) => void
	showSpeakers: boolean
	setShowSpeakers: (value: boolean) => void
	/** «Саммари» over the text: a short block at the start of the transcript. */
	showSummary: boolean
	setShowSummary: (value: boolean) => void
	/** «Темы» over the text: the topics as a column at the right. */
	showTopics: boolean
	setShowTopics: (value: boolean) => void
}

/** Reading preferences for the transcript page — they belong to the view, not to a transcription run. */
export function useTranscriptViewOptions(): TranscriptViewOptions {
	const [textSize, setTextSize] = usePersisted<TranscriptTextSize>(CONFIG_KEYS.textSize, 'md')
	const [showTimestamps, setShowTimestamps] = usePersisted<boolean>(CONFIG_KEYS.showTimestamps, true)
	const [showSpeakers, setShowSpeakers] = usePersisted<boolean>(CONFIG_KEYS.showSpeakers, true)
	// Off until there is something to show: a summary that starts turns both on (session-view).
	const [showSummary, setShowSummary] = usePersisted<boolean>(CONFIG_KEYS.showSummary, false)
	const [showTopics, setShowTopics] = usePersisted<boolean>(CONFIG_KEYS.showTopics, false)
	return {
		textSize,
		setTextSize,
		showTimestamps,
		setShowTimestamps,
		showSpeakers,
		setShowSpeakers,
		showSummary,
		setShowSummary,
		showTopics,
		setShowTopics,
	}
}

/** Type scale for the transcript body; the editor reuses it so swapping one for the other is invisible. */
export const textSizeClass: Record<TranscriptTextSize, string> = {
	sm: 'text-[13px] leading-[1.7]',
	// Tyto: meeting text 15/1.65 (theme.css `.tyto-text-meeting`).
	md: 'tyto-text-meeting text-[15px] leading-[1.65]',
	lg: 'text-[17px] leading-[1.8]',
}
