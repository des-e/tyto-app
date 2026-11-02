import { getCurrentWindow } from '@tauri-apps/api/window'
import { EyeOff, Maximize2, Minimize2, Video } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '~/components/ui/button'
import { m } from '~/paraglide/messages.js'

/** Whether the video is shown next to the text. Hidden by default: the text is the main thing. */
export const VIDEO_PANE_OPEN_KEY = 'tyto.videoPaneOpen'

/** The slim row that stands in for a hidden video. */
export function ShowVideoRow({ onShow }: { onShow: () => void }) {
	return (
		<div data-slot="video-hidden" className="tyto-video-hidden">
			<Button variant="ghost" size="sm" onClick={onShow}>
				<Video />
				{m.tytoShowVideo()}
			</Button>
		</div>
	)
}

async function setWindowFullscreen(on: boolean) {
	try {
		await getCurrentWindow().setFullscreen(on)
	} catch {
		/* the picture still fills the window */
	}
}

/**
 * Shows the player's own `<video>` (it is moved, not copied, so playback goes on). Full screen is a
 * layer over the whole window plus the window itself going full screen: the Fullscreen API of
 * WebView2 and WKWebView only fills the web view.
 */
export function VideoPane({ video, onHide }: { video: HTMLVideoElement; onHide: () => void }) {
	const boxRef = useRef<HTMLDivElement | null>(null)
	const layerRef = useRef<HTMLDivElement | null>(null)
	const [full, setFull] = useState(false)

	useLayoutEffect(() => {
		const host = full ? layerRef.current : boxRef.current
		if (host && video.parentElement !== host) host.prepend(video)
	}, [full, video])

	const enter = useCallback(() => {
		setFull(true)
		void setWindowFullscreen(true)
	}, [])
	const exit = useCallback(() => {
		setFull(false)
		void setWindowFullscreen(false)
	}, [])

	useEffect(() => {
		if (!full) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			exit()
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [exit, full])

	// Leaving the screen while full (another project, back home) gives the window back.
	const fullRef = useRef(full)
	fullRef.current = full
	useEffect(
		() => () => {
			if (fullRef.current) void setWindowFullscreen(false)
		},
		[],
	)

	return (
		<>
			<div ref={boxRef} data-slot="video" className="tyto-video-box group">
				{!full && (
					<div className="tyto-video-actions">
						<Button variant="ghost" size="sm" iconOnly onClick={onHide} aria-label={m.tytoHideVideo()} title={m.tytoHideVideo()} className="tyto-video-action">
							<EyeOff />
						</Button>
						<Button variant="ghost" size="sm" iconOnly onClick={enter} aria-label={m.tytoFullscreen()} title={m.tytoFullscreen()} className="tyto-video-action">
							<Maximize2 />
						</Button>
					</div>
				)}
			</div>
			{full &&
				createPortal(
					<div ref={layerRef} data-slot="video-fullscreen" className="tyto-video-layer group">
						<div className="tyto-video-actions">
							<Button variant="ghost" size="sm" iconOnly onClick={exit} aria-label={m.tytoExitFullscreen()} title={m.tytoExitFullscreen()} className="tyto-video-action">
								<Minimize2 />
							</Button>
						</div>
					</div>,
					document.body,
				)}
		</>
	)
}
