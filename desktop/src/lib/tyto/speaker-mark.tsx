/** Three tones tell speakers apart without colour and survive printing; after three they repeat with a digit. */
const TONES = ['filled', 'outline', 'grey'] as const

export type SpeakerTone = (typeof TONES)[number]

export function speakerTone(speaker: number): { tone: SpeakerTone; cycle: number } {
	const index = Math.max(0, speaker)
	return { tone: TONES[index % TONES.length], cycle: Math.floor(index / TONES.length) + 1 }
}

/** First letter (or digit) of the chosen name, upper-cased: «Анна» → «А». */
function initial(name: string): string | null {
	const match = name.trim().match(/[\p{L}\p{N}]/u)
	return match ? match[0].toLocaleUpperCase() : null
}

/**
 * The 18 px square in front of a speaker's name (theme.css `.tyto-speaker-mark`). A named speaker
 * shows the first letter (plus the cycle digit from the 4th speaker on); an unnamed one, whose label
 * is the default «Говорящий N», shows its number instead, since every default name starts with «Г».
 * Decorative: the name next to it is what assistive tech reads.
 */
export function SpeakerMark({ speaker, name }: { speaker: number; /** the chosen name, if any */ name?: string }) {
	const { tone, cycle } = speakerTone(speaker)
	const letter = name ? initial(name) : null
	return (
		<span aria-hidden="true" data-tone={tone} className="tyto-speaker-mark">
			{letter ? (
				<>
					{letter}
					{cycle > 1 && cycle}
				</>
			) : (
				Math.max(0, speaker) + 1
			)}
		</span>
	)
}
