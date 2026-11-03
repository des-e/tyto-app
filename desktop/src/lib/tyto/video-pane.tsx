import { useLayoutEffect, useRef } from 'react'
import { m } from '~/paraglide/messages.js'
import { useActiveVideo } from './player-media'
import { closeVideoWindow, openVideoWindow, useVideoWindowOpen } from './video-window'

/**
 * The video of the project as a thumbnail at the start of the bottom player (the player's own
 * `<video>`, moved here). A click opens it in its own window on top of other apps; again, closes it.
 */
export function VideoThumb({ path, title }: { path: string; title: string }) {
	const video = useActiveVideo()
	const windowOpen = useVideoWindowOpen()
	const slot = useRef<HTMLDivElement | null>(null)
	useLayoutEffect(() => {
		const host = slot.current
		if (video && host && video.parentElement !== host) host.prepend(video)
	})
	if (!video) return null
	const label = windowOpen ? m.tytoVideoWindowClose() : m.tytoVideoWindowOpen()
	return (
		<button
			type="button"
			onClick={() => void (windowOpen ? closeVideoWindow() : openVideoWindow(path, title))}
			aria-label={label}
			aria-pressed={windowOpen}
			title={label}
			className="tyto-video-thumb">
			<div ref={slot} data-slot="video-thumb" className="tyto-video-thumb-slot" />
		</button>
	)
}
