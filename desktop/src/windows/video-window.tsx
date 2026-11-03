import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { VIDEO_READY_EVENT, VIDEO_SYNC_EVENT, VIDEO_TOGGLE_EVENT, type VideoSync } from '~/lib/tyto/video-window'

interface VideoSource {
	path: string
	title: string
}

/** Further off than this from the main player, the copy jumps to it. */
const DRIFT_SECONDS = 0.35

/**
 * The project video in its own window (Tyto, screen/video_window.rs): a muted copy that follows the
 * main player, which keeps the sound. A click on the picture plays or pauses the main player.
 */
export default function VideoWindow() {
	const [source, setSource] = useState<VideoSource | null>(null)
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

	if (!source) return null
	return (
		<video
			ref={videoRef}
			key={source.path}
			src={convertFileSrc(source.path)}
			muted
			playsInline
			preload="auto"
			aria-label={source.title}
			onLoadedMetadata={() => apply(lastSync.current)}
			onClick={() => void emitTo('main', VIDEO_TOGGLE_EVENT).catch(() => {})}
			style={{ display: 'block', width: '100vw', height: '100vh', objectFit: 'contain', background: '#000', cursor: 'pointer' }}
		/>
	)
}
