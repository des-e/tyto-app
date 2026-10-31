import type { Segment } from '~/lib/transcript'

/** A run of consecutive lines by one speaker: the transcript shows the name once per run. */
export interface Replica {
	/** null when diarization left the lines unattributed (or was off). */
	speaker: number | null
	segments: Segment[]
}

/** Joins consecutive segments of the same speaker into series. Without diarization everything is one series. */
export function groupReplicas(segments: Segment[]): Replica[] {
	const series: Replica[] = []
	for (const segment of segments) {
		const speaker = segment.speaker ?? null
		const last = series[series.length - 1]
		if (last && last.speaker === speaker) last.segments.push(segment)
		else series.push({ speaker, segments: [segment] })
	}
	return series
}

/** For each segment, whether it opens a series (the row that carries the speaker's name). */
export function seriesStarts(segments: Segment[]): boolean[] {
	return groupReplicas(segments).flatMap((replica) => replica.segments.map((_, index) => index === 0))
}
