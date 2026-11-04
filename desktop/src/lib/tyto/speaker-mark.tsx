/** Three tones tell speakers apart on the timeline without colour; after three they repeat. */
const TONES = ['filled', 'outline', 'grey'] as const

export type SpeakerTone = (typeof TONES)[number]

export function speakerTone(speaker: number): { tone: SpeakerTone; cycle: number } {
	const index = Math.max(0, speaker)
	return { tone: TONES[index % TONES.length], cycle: Math.floor(index / TONES.length) + 1 }
}

/** Only the first six speakers get a colour (design round 3); the rest are grey. */
export const SPEAKER_COLORS = 6

/** 1–6 for a coloured speaker, 0 for grey (theme.css `--tyto-speaker-N`). */
export function speakerColor(speaker: number): number {
	const index = Math.max(0, speaker)
	return index < SPEAKER_COLORS ? index + 1 : 0
}

/** First letter (or digit) of the chosen name, upper-cased: «Анна» → «А». */
function initial(name: string): string | null {
	const match = name.trim().match(/[\p{L}\p{N}]/u)
	return match ? match[0].toLocaleUpperCase() : null
}

/**
 * A speaker's mark (theme.css `.tyto-speaker-mark`). `avatar` is a pale round badge: the first letter
 * of the chosen name, or the speaker's number while the label is the default «Говорящий N» (every
 * default name starts with «Г»). `dot` is the 8 px dot in front of the name in the text.
 * Decorative: the name next to it is what assistive tech reads.
 */
export function SpeakerMark({
	speaker,
	name,
	variant = 'avatar',
}: {
	speaker: number
	/** the chosen name, if any */
	name?: string
	variant?: 'avatar' | 'dot'
}) {
	const color = speakerColor(speaker)
	if (variant === 'dot') return <span aria-hidden="true" data-color={color} data-variant="dot" className="tyto-speaker-mark" />
	const letter = name ? initial(name) : null
	return (
		<span aria-hidden="true" data-color={color} data-variant="avatar" className="tyto-speaker-mark">
			{letter ?? Math.max(0, speaker) + 1}
		</span>
	)
}
