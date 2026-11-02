import { convertFileSrc } from '@tauri-apps/api/core'
import { useSyncExternalStore } from 'react'
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
		if (shown === el) setShown(null)
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
