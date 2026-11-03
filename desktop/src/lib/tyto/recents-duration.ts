import { useEffect, useState } from 'react'
import { readTranscript, TRANSCRIPTS_CHANGED_EVENT } from '~/lib/transcripts-store'

/**
 * What the sidebar meta needs from a saved record («10:02 · 48 мин · Не расшифровано»). The list
 * itself is built from folder names only, so the record is read lazily by the row that shows it:
 * the list is virtualized, which keeps it to the rows on screen, and each record is read once until
 * the store announces a change.
 */
export interface RecordMeta {
	/** Seconds: the end of the last line, else the length stored with the media. */
	duration: number | null
	/** The project holds media but no transcript yet (a recording, say). */
	untranscribed: boolean
}

const EMPTY: RecordMeta = { duration: null, untranscribed: false }

const cache = new Map<string, Promise<RecordMeta | null>>()

let listening = false

/** The cached meta of one saved record; null when it cannot be read yet. Shared with «Ждут расшифровки». */
export function loadRecordMeta(path: string) {
	return load(path)
}

function load(path: string) {
	// Rows scrolled out of view are not listening; their entries are dropped here.
	if (!listening && typeof window !== 'undefined') {
		listening = true
		window.addEventListener(TRANSCRIPTS_CHANGED_EVENT, () => cache.clear())
	}
	let pending = cache.get(path)
	if (!pending) {
		pending = readTranscript(path).then(
			(record): RecordMeta | null => {
				if (!record) return null
				const last = record.segments[record.segments.length - 1]
				// Segment times are in centiseconds.
				const duration = last ? last.stop / 100 : (record.durationSeconds ?? null)
				return { duration, untranscribed: record.segments.length === 0 }
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

export function useRecordMeta(path: string): RecordMeta {
	const [meta, setMeta] = useState<RecordMeta>(EMPTY)
	useEffect(() => {
		let alive = true
		const fetch = () =>
			void load(path).then((value) => {
				if (alive) setMeta(value ?? EMPTY)
			})
		// A save, rename or re-transcription may have changed the record behind this path.
		const onChanged = () => {
			cache.delete(path)
			fetch()
		}
		setMeta(EMPTY)
		fetch()
		window.addEventListener(TRANSCRIPTS_CHANGED_EVENT, onChanged)
		return () => {
			alive = false
			window.removeEventListener(TRANSCRIPTS_CHANGED_EVENT, onChanged)
		}
	}, [path])
	return meta
}
