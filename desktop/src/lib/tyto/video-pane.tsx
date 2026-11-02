import { getCurrentWindow } from '@tauri-apps/api/window'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '~/components/ui/button'
import { m } from '~/paraglide/messages.js'

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
export function VideoPane({ video }: { video: HTMLVideoElement }) {
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
					<Button variant="ghost" size="sm" iconOnly onClick={enter} aria-label={m.tytoFullscreen()} title={m.tytoFullscreen()} className="tyto-video-action">
						<Maximize2 />
					</Button>
				)}
			</div>
			{full &&
				createPortal(
					<div ref={layerRef} data-slot="video-fullscreen" className="tyto-video-layer group">
						<Button variant="ghost" size="sm" iconOnly onClick={exit} aria-label={m.tytoExitFullscreen()} title={m.tytoExitFullscreen()} className="tyto-video-action">
							<Minimize2 />
						</Button>
					</div>,
					document.body,
				)}
		</>
	)
}
