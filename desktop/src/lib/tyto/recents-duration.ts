import { useEffect, useState } from 'react'
import { readTranscript, TRANSCRIPTS_CHANGED_EVENT } from '~/lib/transcripts-store'

/**
 * Length of a saved recording for the sidebar meta («10:02 · 48 мин»). The list itself is built from
 * folder names only, so the record is read lazily by the row that shows it: the list is virtualized,
 * which keeps it to the rows on screen, and each record is read once until the store announces a
 * change.
 */
const cache = new Map<string, Promise<number | null>>()

let listening = false

function load(path: string) {
	// Rows scrolled out of view are not listening; their entries are dropped here.
	if (!listening && typeof window !== 'undefined') {
		listening = true
		window.addEventListener(TRANSCRIPTS_CHANGED_EVENT, () => cache.clear())
	}
	let pending = cache.get(path)
	if (!pending) {
		pending = readTranscript(path).then(
			(record) => {
				const last = record?.segments[record.segments.length - 1]
				// Segment times are in centiseconds.
				return last ? last.stop / 100 : null
			},
			() => null,
		)
		// An unreadable record (still being written, say) is tried again the next time its row mounts.
		void pending.then((value) => {
			if (value === null) cache.delete(path)
		})
		cache.set(path, pending)
	}
	return pending
}

export function useRecordDuration(path: string): number | null {
	const [seconds, setSeconds] = useState<number | null>(null)
	useEffect(() => {
		let alive = true
		const fetch = () =>
			void load(path).then((value) => {
				if (alive) setSeconds(value)
			})
		// A save, rename or re-transcription may have changed the record behind this path.
		const onChanged = () => {
			cache.delete(path)
			fetch()
		}
		setSeconds(null)
		fetch()
		window.addEventListener(TRANSCRIPTS_CHANGED_EVENT, onChanged)
		return () => {
			alive = false
			window.removeEventListener(TRANSCRIPTS_CHANGED_EVENT, onChanged)
		}
	}, [path])
	return seconds
}
