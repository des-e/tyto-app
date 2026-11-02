import { convertFileSrc } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSyncExternalStore } from 'react'
import { readConfig, writeConfig } from '~/lib/config-store'
import { isVideoPath } from './media-path'

/**
 * The bottom player owns the media element. For a video it is a `<video>`, and the video pane
 * borrows that same element into its own box, so seeking, the clock and the replica highlight keep
 * working through the player's events with nothing new to wire. Audio stays a detached `new Audio()`.
 */

// Shown only once the metadata says there is a picture: an MP4 with sound only stays an audio screen.
let shown: HTMLVideoElement | null = null
let pending: HTMLVideoElement | null = null
const listeners = new Set<() => void>()

function setShown(next: HTMLVideoElement | null) {
	if (shown === next) return
	shown = next
	for (const listener of listeners) listener()
}

function onMetadata(this: HTMLVideoElement) {
	if (pending === this && this.videoWidth > 0) setShown(this)
}

export function createPlayerMedia(path: string): HTMLMediaElement {
	if (!isVideoPath(path)) {
		const audio = new Audio(convertFileSrc(path))
		audio.preload = 'metadata'
		return audio
	}
	const video = document.createElement('video')
	video.playsInline = true
	video.preload = 'metadata'
	video.className = 'tyto-video'
	video.addEventListener('loadedmetadata', onMetadata)
	pending = video
	setShown(null)
	video.src = convertFileSrc(path)
	return video
}

export function releasePlayerMedia(el: HTMLMediaElement) {
	el.pause()
	el.src = ''
	el.remove()
	if (el instanceof HTMLVideoElement) {
		el.removeEventListener('loadedmetadata', onMetadata)
		if (pending === el) pending = null
		if (shown === el) {
			setShown(null)
			// Another project or back home while full: give the window back.
			setVideoFullscreen(false)
		}
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/** The video to show next to the text, or null (audio, no picture, or nothing loaded). */
export function useActiveVideo(): HTMLVideoElement | null {
	return useSyncExternalStore(
		subscribe,
		() => shown,
		() => null,
	)
}

/**
 * Where the video is: a column right of the text in a wide window (`side`), a thumbnail in the
 * bottom player when the window is narrow or the column was hidden (`mini`), or over the whole
 * window (`full`). One store for the player and the session view, so a change moves the element
 * in a single render.
 */
export type VideoPlace = 'side' | 'mini' | 'full'

/** The column was hidden by hand: the thumbnail stays. */
export const VIDEO_PANE_OPEN_KEY = 'tyto.videoPaneOpen'
/** From this window width the column fits next to the text. */
export const VIDEO_SIDE_QUERY = '(min-width: 900px)'

interface VideoView {
	wide: boolean
	open: boolean
	full: boolean
}

let view: VideoView | null = null
const viewListeners = new Set<() => void>()

function currentView(): VideoView {
	if (view) return view
	const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(VIDEO_SIDE_QUERY) : null
	view = { wide: query ? query.matches : true, open: readConfig(VIDEO_PANE_OPEN_KEY, true), full: false }
	query?.addEventListener('change', (event) => setView({ wide: event.matches }))
	return view
}

function setView(patch: Partial<VideoView>) {
	view = { ...currentView(), ...patch }
	for (const listener of viewListeners) listener()
}

function subscribeView(listener: () => void) {
	viewListeners.add(listener)
	return () => {
		viewListeners.delete(listener)
	}
}

function placeOf(v: VideoView): VideoPlace {
	if (v.full) return 'full'
	return v.wide && v.open ? 'side' : 'mini'
}

export function useVideoPlace(): { place: VideoPlace; wide: boolean } {
	const v = useSyncExternalStore(subscribeView, currentView, currentView)
	return { place: placeOf(v), wide: v.wide }
}

export function setVideoOpen(open: boolean) {
	writeConfig(VIDEO_PANE_OPEN_KEY, open)
	setView({ open })
}

/**
 * The window itself goes full screen too: the Fullscreen API of WebView2 and WKWebView only fills
 * the web view.
 */
export function setVideoFullscreen(full: boolean) {
	if (currentView().full === full) return
	setView({ full })
	void getCurrentWindow()
		.setFullscreen(full)
		.catch(() => {
			/* the picture still fills the window */
		})
}

/** Tests: forget the window width and the hidden column. */
export function resetVideoView() {
	view = null
}
