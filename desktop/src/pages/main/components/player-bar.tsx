import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import * as dialog from '@tauri-apps/plugin-dialog'
import * as fs from '@tauri-apps/plugin-fs'
import { motion } from 'framer-motion'
import { Download, FolderOpen, Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { PlaybackRateButton } from '~/components/playback-rate-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { usePlaybackRate } from '~/lib/playback-rate'
import { PlayerClock, ReplicaTimeline } from '~/lib/tyto/replica-timeline'
import type { NamedPath } from '~/lib/types'
import type { Job } from '../hooks/use-transcribe-queue'

/**
 * Fired on `window` with `{ seconds }` to move this player, so anything on screen (a transcript
 * timestamp, for one) can seek without a handle on the audio element.
 */
export const PLAYER_SEEK_EVENT = 'vibe:player-seek'

/**
 * Fired on `window` with `{ seconds, playing }` while the media plays (and on every seek, play and
 * pause) so the transcript can follow along without owning the audio element.
 */
export const PLAYER_TIME_EVENT = 'vibe:player-time'

/** Fired on `window` to play/pause from elsewhere — the transcript's spacebar shortcut. */
export const PLAYER_TOGGLE_EVENT = 'vibe:player-toggle'

export interface PlayerTimeDetail {
	seconds: number
	playing: boolean
}

/** Containing folder of a path, for both posix and windows separators. */
function dirname(path: string) {
	const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
	return index > 0 ? path.slice(0, index) : path
}

function basename(path: string) {
	return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

function extension(path: string) {
	const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
	const dot = name.lastIndexOf('.')
	return dot > 0 ? name.slice(dot + 1) : ''
}

export default function PlayerBar({ job }: { job: Job }) {
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const [playing, setPlaying] = useState(false)
	const [currentTime, setCurrentTime] = useState(0)
	const [duration, setDuration] = useState(Number.NaN)

	const sourcePath = job.path
	const seekable = Number.isFinite(duration) && duration > 0

	// The transcript highlights the line being spoken; it reads the position from these events.
	const broadcast = useCallback((seconds: number, isPlaying: boolean) => {
		window.dispatchEvent(new CustomEvent<PlayerTimeDetail>(PLAYER_TIME_EVENT, { detail: { seconds, playing: isPlaying } }))
	}, [])

	// One audio element per source: switching files stops playback and swaps the stream.
	useEffect(() => {
		const audio = new Audio(convertFileSrc(sourcePath))
		audio.preload = 'metadata'
		audioRef.current = audio
		setPlaying(false)
		setCurrentTime(0)
		setDuration(Number.NaN)
		broadcast(0, false)

		const onTime = () => {
			setCurrentTime(audio.currentTime)
			broadcast(audio.currentTime, !audio.paused)
		}
		const onMetadata = () => setDuration(audio.duration)
		const onPlay = () => {
			setPlaying(true)
			broadcast(audio.currentTime, true)
		}
		const onPause = () => {
			setPlaying(false)
			broadcast(audio.currentTime, false)
		}
		const onEnded = () => {
			setPlaying(false)
			setCurrentTime(0)
			broadcast(0, false)
		}

		audio.addEventListener('timeupdate', onTime)
		audio.addEventListener('loadedmetadata', onMetadata)
		audio.addEventListener('durationchange', onMetadata)
		audio.addEventListener('play', onPlay)
		audio.addEventListener('pause', onPause)
		audio.addEventListener('ended', onEnded)

		return () => {
			audio.removeEventListener('timeupdate', onTime)
			audio.removeEventListener('loadedmetadata', onMetadata)
			audio.removeEventListener('durationchange', onMetadata)
			audio.removeEventListener('play', onPlay)
			audio.removeEventListener('pause', onPause)
			audio.removeEventListener('ended', onEnded)
			audio.pause()
			audio.src = ''
			if (audioRef.current === audio) audioRef.current = null
		}
	}, [broadcast, sourcePath])
	const { playbackRate, cyclePlaybackRate } = usePlaybackRate(audioRef, sourcePath)

	// `timeupdate` only fires ~4x/second which makes the fill step visibly; while playing, the
	// position is sampled every animation frame instead so the bar glides.
	useEffect(() => {
		if (!playing) return
		let frame = 0
		const tick = () => {
			const audio = audioRef.current
			if (audio) {
				setCurrentTime(audio.currentTime)
				broadcast(audio.currentTime, true)
			}
			frame = requestAnimationFrame(tick)
		}
		frame = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(frame)
	}, [playing])

	const toggle = useCallback(() => {
		const audio = audioRef.current
		if (!audio) return
		if (audio.paused) void audio.play().catch(() => setPlaying(false))
		else audio.pause()
	}, [])

	const seekTo = useCallback(
		(seconds: number) => {
			const audio = audioRef.current
			if (!audio || !seekable) return
			const next = Math.min(Math.max(seconds, 0), duration)
			audio.currentTime = next
			setCurrentTime(next)
			broadcast(next, !audio.paused)
		},
		[broadcast, duration, seekable],
	)

	// Seek requests from elsewhere in the window (transcript timestamps). Read straight off the
	// element so the handler never goes stale, and no-op while there is nothing to seek yet.
	useEffect(() => {
		const onSeekRequest = (event: Event) => {
			const seconds = (event as CustomEvent<{ seconds?: number }>).detail?.seconds
			const audio = audioRef.current
			if (!audio || typeof seconds !== 'number' || !Number.isFinite(seconds)) return
			const limit = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number.POSITIVE_INFINITY
			const next = Math.min(Math.max(seconds, 0), limit)
			try {
				audio.currentTime = next
			} catch {
				// The media has no seekable range yet; nothing to do.
				return
			}
			setCurrentTime(next)
			broadcast(next, true)
			if (audio.paused) void audio.play().catch(() => setPlaying(false))
		}
		window.addEventListener(PLAYER_SEEK_EVENT, onSeekRequest)
		window.addEventListener(PLAYER_TOGGLE_EVENT, toggle)
		return () => {
			window.removeEventListener(PLAYER_SEEK_EVENT, onSeekRequest)
			window.removeEventListener(PLAYER_TOGGLE_EVENT, toggle)
		}
	}, [broadcast, toggle])

	async function revealInFolder() {
		try {
			await invoke('open_path', { path: dirname(sourcePath) })
		} catch {
			toast.error(m.couldNotOpenFolder(), { position: 'bottom-center' })
		}
	}

	async function saveACopy() {
		const ext = extension(sourcePath)
		try {
			let defaultPath = sourcePath
			try {
				const suggested = await invoke<NamedPath>('get_save_path', { srcPath: sourcePath, targetExt: ext })
				defaultPath = suggested.path
			} catch {
				// Falling back to the source path as the dialog suggestion is fine.
			}
			const target = await dialog.save({
				filters: ext ? [{ name: '', extensions: [ext] }] : undefined,
				canCreateDirectories: true,
				defaultPath,
			})
			if (!target) return
			await fs.copyFile(sourcePath, target)
			toast.success(m.saveSuccess(), {
				description: job.name,
				position: 'bottom-center',
				action: { label: m.findHere(), onClick: () => void invoke('open_path', { path: dirname(target) }) },
			})
		} catch {
			toast.error(m.audioCopyUnavailable(), { position: 'bottom-center' })
		}
	}

	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2, ease: 'easeOut' }}
			className="tyto-bar tyto-player sticky bottom-0 z-10">
			{/* Transport controls read left-to-right in every locale, like the timeline they drive. */}
			<div dir="ltr" className="flex min-w-0 flex-1 items-center gap-3">
				<Button iconOnly size="md" onClick={toggle} aria-label={playing ? m.pause() : m.play()} className="h-8 w-8 shrink-0">
					{playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
				</Button>
				<PlayerClock currentTime={currentTime} duration={duration} />
				<ReplicaTimeline segments={job.segments} duration={duration} currentTime={currentTime} seekable={seekable} onSeek={seekTo} onToggle={toggle} />
			</div>

			<PlaybackRateButton playbackRate={playbackRate} onCycle={cyclePlaybackRate} />

			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="ghost" size="sm" iconOnly onClick={() => void revealInFolder()} aria-label={m.showInFolder()} className="shrink-0">
						<FolderOpen />
					</Button>
				</TooltipTrigger>
				{/* The loaded file, so it is clear which folder will open. */}
				<TooltipContent side="top">{basename(sourcePath)}</TooltipContent>
			</Tooltip>

			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="ghost" size="iconSm" onClick={() => void saveACopy()} aria-label={m.save()} className="shrink-0">
						<Download className="h-4 w-4" />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">{m.save()}</TooltipContent>
			</Tooltip>
		</motion.div>
	)
}
