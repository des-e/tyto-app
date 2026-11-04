import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import { Pause, Play } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CONFIG_KEYS } from '~/lib/config-keys'
import { readConfig } from '~/lib/config-store'
import { supportedLanguages } from '~/lib/i18n'
import { VIDEO_READY_EVENT, VIDEO_SEEK_EVENT, VIDEO_SYNC_EVENT, VIDEO_TOGGLE_EVENT, type VideoSync } from '~/lib/tyto/video-window'
import { m } from '~/paraglide/messages.js'
import { getLocale, setLocale } from '~/paraglide/runtime.js'

interface VideoSource {
	path: string
	title: string
}

/** Further off than this from the main player, the copy jumps to it. */
const DRIFT_SECONDS = 0.35

/** «0:14», «48:00», «1:02:03». */
export function clock(seconds: number) {
	const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
	const h = Math.floor(total / 3600)
	const mm = String(Math.floor((total % 3600) / 60)).padStart(h ? 2 : 1, '0')
	const ss = String(total % 60).padStart(2, '0')
	return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * The project video in its own window (Tyto, screen/video_window.rs): a muted copy that follows the
 * main player, which keeps the sound. On hover a bar shows pause, the time and a slider; the slider
 * moves the main player, and the copy follows it back (design round 7). A click on the picture plays
 * or pauses the main player too.
 */
export default function VideoWindow() {
	const configuredLocale = readConfig(CONFIG_KEYS.displayLanguage, 'en-US')
	if (supportedLanguages[configuredLocale] && configuredLocale !== getLocale()) {
		setLocale(configuredLocale as never, { reload: false })
	}

	const [source, setSource] = useState<VideoSource | null>(null)
	const [playing, setPlaying] = useState(false)
	const [current, setCurrent] = useState(0)
	const [duration, setDuration] = useState(0)
	// While the slider is held, it shows where it is, not where the video is.
	const [dragging, setDragging] = useState<number | null>(null)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const lastSync = useRef<VideoSync | null>(null)

	useLayoutEffect(() => {
		document.title = 'Tyto'
		document.documentElement.style.background = '#000'
		document.body.style.background = '#000'
		document.body.style.margin = '0'
	}, [])

	function apply(sync: VideoSync | null) {
		const video = videoRef.current
		if (!video || !sync) return
		setPlaying(sync.playing)
		if (video.playbackRate !== sync.rate) video.playbackRate = sync.rate
		if (Math.abs(video.currentTime - sync.seconds) > DRIFT_SECONDS) video.currentTime = sync.seconds
		if (sync.playing && video.paused) void video.play().catch(() => {})
		if (!sync.playing && !video.paused) video.pause()
	}

	useEffect(() => {
		let cancelled = false
		const unlisteners = [
			listen<VideoSource>('video-window-source', ({ payload }) => setSource(payload)),
			listen<VideoSync>(VIDEO_SYNC_EVENT, ({ payload }) => {
				lastSync.current = payload
				apply(payload)
			}),
		]
		void invoke<VideoSource | null>('video_window_source')
			.then((initial) => {
				if (!cancelled && initial) setSource(initial)
			})
			.catch((error) => console.error('video window source:', error))
			.finally(() => void emitTo('main', VIDEO_READY_EVENT).catch(() => {}))
		return () => {
			cancelled = true
			for (const unlisten of unlisteners) void unlisten.then((dispose) => dispose()).catch(() => {})
		}
	}, [])

	const toggle = () => void emitTo('main', VIDEO_TOGGLE_EVENT).catch(() => {})
	const seek = (seconds: number) => void emitTo('main', VIDEO_SEEK_EVENT, { seconds }).catch(() => {})

	if (!source) return null
	const shown = dragging ?? current

	return (
		<div className="tyto-video-window">
			<video
				ref={videoRef}
				key={source.path}
				src={convertFileSrc(source.path)}
				muted
				playsInline
				preload="auto"
				aria-label={source.title}
				onLoadedMetadata={(event) => {
					setDuration(event.currentTarget.duration)
					apply(lastSync.current)
				}}
				onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
				onClick={toggle}
			/>
			<div className="tyto-video-bar">
				<button type="button" onClick={toggle} aria-label={playing ? m.pause() : m.play()} title={playing ? m.pause() : m.play()}>
					{playing ? <Pause aria-hidden className="h-3.5 w-3.5 fill-current" /> : <Play aria-hidden className="h-3.5 w-3.5 fill-current" />}
				</button>
				<span className="tyto-video-time">
					{clock(shown)} <span>/ {clock(duration)}</span>
				</span>
				<input
					type="range"
					aria-label={m.seek()}
					min={0}
					max={duration || 0}
					step={0.1}
					value={Math.min(shown, duration || 0)}
					onChange={(event) => setDragging(Number(event.target.value))}
					onPointerUp={(event) => {
						seek(Number(event.currentTarget.value))
						setDragging(null)
					}}
					onKeyUp={(event) => {
						seek(Number(event.currentTarget.value))
						setDragging(null)
					}}
					style={{ ['--tyto-video-progress' as string]: `${duration ? (Math.min(shown, duration) / duration) * 100 : 0}%` }}
				/>
				<span className="tyto-video-note">{m.videoSoundFromTyto()}</span>
			</div>
		</div>
	)
}
