import { convertFileSrc } from '@tauri-apps/api/core'
import { useSyncExternalStore } from 'react'
import { isVideoPath } from './media-path'
import { closeVideoWindow } from './video-window'

/**
 * The bottom player owns the media element. For a video it is a `<video>`: a thumbnail at the
 * start of the player shows it, and a click opens the video in its own window (video-window.ts),
 * which follows this element. Audio stays a detached `new Audio()`.
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
			// Another project or back home: the window of this video goes too.
			void closeVideoWindow()
		}
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/** The video of the open project, or null (audio, no picture, or nothing loaded). */
export function useActiveVideo(): HTMLVideoElement | null {
	return useSyncExternalStore(
		subscribe,
		() => shown,
		() => null,
	)
}
