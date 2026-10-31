import { useCallback, useMemo, useRef } from 'react'
import type { Segment } from '~/lib/transcript'
import { m } from '~/paraglide/messages.js'
import { groupReplicas } from './group-replicas'
import { speakerTone, type SpeakerTone } from './speaker-mark'

/** «00:51», «48:10», «1:05:10»; «--:--» while the media has no usable length. */
export function formatClock(seconds: number) {
	if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
	const total = Math.floor(seconds)
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const rest = String(total % 60).padStart(2, '0')
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${String(minutes).padStart(2, '0')}:${rest}`
}

/** «00:51 / 48:10»: the position in the text colour, the length muted. */
export function PlayerClock({ currentTime, duration }: { currentTime: number; duration: number }) {
	return (
		<span className="tyto-player-clock">
			<b>{formatClock(currentTime)}</b> / {formatClock(duration)}
		</span>
	)
}

interface Piece {
	/** seconds */
	start: number
	stop: number
	/** `rest`: the part of the media nobody has transcribed yet, no speaker. */
	tone: SpeakerTone | 'rest'
}

/** One piece per series of a speaker's lines; the untranscribed rest of the media is one more, untoned. */
function pieces(segments: Segment[], total: number): Piece[] {
	const result: Piece[] = groupReplicas(segments).map((replica) => ({
		start: replica.segments[0].start / 100,
		stop: replica.segments[replica.segments.length - 1].stop / 100,
		tone: speakerTone(replica.speaker ?? 0).tone,
	}))
	const end = result.length ? result[result.length - 1].stop : 0
	if (total - end >= 1) result.push({ start: end, stop: total, tone: 'rest' })
	return result
}

/**
 * Seek bar made of the transcript's replicas (difference 8): one piece per series of a speaker's lines,
 * in greys by speaker (the same three tones as the speaker marks), on both sides of the playhead:
 * unplayed tones step up from the track grey (`--tyto-track`, ≥ 3:1), played ones are darker and
 * further apart; the playhead marks the position. Pressing jumps to the position under the
 * cursor; dragging scrubs from there. Arrows move 5 s, space plays and pauses.
 */
export function ReplicaTimeline({
	segments,
	duration,
	currentTime,
	seekable,
	onSeek,
	onToggle,
}: {
	segments: Segment[]
	/** seconds; NaN until the media reports it */
	duration: number
	currentTime: number
	seekable: boolean
	onSeek: (seconds: number) => void
	onToggle: () => void
}) {
	const trackRef = useRef<HTMLDivElement>(null)
	const lastStop = segments.length ? segments[segments.length - 1].stop / 100 : 0
	// The pieces are laid out on the media's length; before it is known (or when the transcript runs
	// past a misreported length), on the transcript's.
	const total = Math.max(Number.isFinite(duration) && duration > 0 ? duration : 0, lastStop)
	const layout = useMemo(() => (total > 0 ? pieces(segments, total) : []), [segments, total])
	const progress = total > 0 ? Math.min(Math.max(currentTime / total, 0), 1) : 0

	const seekToClientX = useCallback(
		(clientX: number) => {
			const track = trackRef.current
			if (!track) return
			const rect = track.getBoundingClientRect()
			if (rect.width === 0) return
			onSeek(Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * total)
		},
		[onSeek, total],
	)

	const place = (piece: Piece) => ({
		left: `${(piece.start / total) * 100}%`,
		// 2 px between pieces, never thinner than 2 px.
		width: `max(2px, calc(${((piece.stop - piece.start) / total) * 100}% - 2px))`,
	})

	return (
		<div
			ref={trackRef}
			role="slider"
			tabIndex={seekable ? 0 : -1}
			aria-label={m.seek()}
			aria-valuemin={0}
			aria-valuemax={seekable ? Math.floor(duration) : 0}
			aria-valuenow={Math.floor(currentTime)}
			aria-valuetext={`${formatClock(currentTime)} / ${formatClock(duration)}`}
			aria-disabled={!seekable}
			data-seekable={seekable}
			className="tyto-timeline"
			onPointerDown={(event) => {
				if (!seekable || event.button !== 0) return
				event.currentTarget.setPointerCapture?.(event.pointerId)
				seekToClientX(event.clientX)
			}}
			onPointerMove={(event) => {
				if (!seekable || !event.currentTarget.hasPointerCapture?.(event.pointerId)) return
				seekToClientX(event.clientX)
			}}
			onPointerUp={(event) => {
				if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
			}}
			onKeyDown={(event) => {
				if (!seekable) return
				if (event.key === 'ArrowRight') {
					event.preventDefault()
					onSeek(currentTime + 5)
				} else if (event.key === 'ArrowLeft') {
					event.preventDefault()
					onSeek(currentTime - 5)
				} else if (event.key === ' ') {
					event.preventDefault()
					onToggle()
				}
			}}>
			{layout.length === 0 ? (
				<div className="tyto-timeline-replica tyto-timeline-empty" />
			) : (
				<>
					<div className="tyto-timeline-layer">
						{layout.map((piece) => (
							<div key={piece.start} data-replica-start={piece.start} data-tone={piece.tone} className="tyto-timeline-replica" style={place(piece)} />
						))}
					</div>
					<div aria-hidden="true" className="tyto-timeline-layer tyto-timeline-played" style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}>
						{layout.map((piece) => (
							<div key={piece.start} data-tone={piece.tone} className="tyto-timeline-replica" style={place(piece)} />
						))}
					</div>
				</>
			)}
			<div aria-hidden="true" className="tyto-timeline-head" style={{ left: `${progress * 100}%` }} />
		</div>
	)
}
