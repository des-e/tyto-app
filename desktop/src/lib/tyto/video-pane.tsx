import { EyeOff, Maximize2, Minimize2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '~/components/ui/button'
import { m } from '~/paraglide/messages.js'
import { setVideoFullscreen, setVideoOpen, useActiveVideo, useVideoPlace } from './player-media'

/**
 * The player's own `<video>` lives in one place at a time: the column right of the text (wide
 * window), a thumbnail in the bottom player (narrow window or hidden column) or a layer over the
 * window. The element is moved, never copied, so playback goes on.
 */
function useVideoSlot(video: HTMLVideoElement | null, active: boolean) {
	const ref = useRef<HTMLDivElement | null>(null)
	// Every render: the slot that is active takes the element, wherever it was.
	useLayoutEffect(() => {
		const host = ref.current
		if (active && video && host && video.parentElement !== host) host.prepend(video)
	})
	return ref
}

/** Variant E: the video in a narrow column right of the text, topics below it (plan 3). */
export function VideoSideColumn({ video }: { video: HTMLVideoElement }) {
	const { place } = useVideoPlace()
	const slot = useVideoSlot(video, place === 'side')
	return (
		<div className="tyto-video-side">
			<div ref={slot} data-slot="video" className="tyto-video-box" />
			<div className="tyto-video-side-actions">
				<Button variant="ghost" size="sm" onClick={() => setVideoOpen(false)}>
					<EyeOff />
					{m.tytoHideVideo()}
				</Button>
				<Button variant="ghost" size="sm" iconOnly onClick={() => setVideoFullscreen(true)} aria-label={m.tytoFullscreen()} title={m.tytoFullscreen()}>
					<Maximize2 />
				</Button>
			</div>
			{/* Topics of the conversation go under the video (plan 3). */}
			<div data-slot="topics" />
		</div>
	)
}

/**
 * Variant A: a thumbnail at the start of the bottom player. A click brings the column back in a
 * wide window and goes full screen in a narrow one.
 */
export function VideoThumb() {
	const video = useActiveVideo()
	const { place, wide } = useVideoPlace()
	const slot = useVideoSlot(video, place === 'mini')
	if (!video || place === 'side') return null
	const label = wide ? m.tytoShowVideo() : m.tytoFullscreen()
	return (
		<button
			type="button"
			onClick={() => (wide ? setVideoOpen(true) : setVideoFullscreen(true))}
			aria-label={label}
			title={label}
			className="tyto-video-thumb">
			<div ref={slot} data-slot="video-thumb" className="tyto-video-thumb-slot" />
		</button>
	)
}

/** The video over the whole window; Esc or the button gives it back. */
export function VideoFullscreenLayer() {
	const video = useActiveVideo()
	const { place } = useVideoPlace()
	const full = place === 'full' && !!video
	const slot = useVideoSlot(video, full)

	useEffect(() => {
		if (!full) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			setVideoFullscreen(false)
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [full])

	if (!full) return null
	return createPortal(
		<div ref={slot} data-slot="video-fullscreen" className="tyto-video-layer group">
			<div className="tyto-video-actions">
				<Button variant="ghost" size="sm" iconOnly onClick={() => setVideoFullscreen(false)} aria-label={m.tytoExitFullscreen()} title={m.tytoExitFullscreen()} className="tyto-video-action">
					<Minimize2 />
				</Button>
			</div>
		</div>,
		document.body,
	)
}
