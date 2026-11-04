import { invoke } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import { useSyncExternalStore } from 'react'

/**
 * The project video in its own window (screen/video_window.rs). The main player keeps the sound;
 * the window plays a muted copy and follows these sync messages: sent on every play, pause, speed
 * change or jump, and once a second while playing so the copy never drifts far.
 */
export const VIDEO_WINDOW_LABEL = 'video-window'
export const VIDEO_SYNC_EVENT = 'video-sync'
/** From the video window: a click on the picture plays or pauses the main player. */
export const VIDEO_TOGGLE_EVENT = 'video-window-toggle'
/** From the video window: its slider moved, `{ seconds }`; the main player jumps there (design round 7). */
export const VIDEO_SEEK_EVENT = 'video-window-seek'
/** From the video window: its page loaded and wants the current position. */
export const VIDEO_READY_EVENT = 'video-window-ready'
const CLOSED_EVENT = 'video-window-closed'

export interface VideoSync {
	seconds: number
	playing: boolean
	rate: number
}

/** More than this off where the copy should be: tell it. */
const JUMP_SECONDS = 0.5
/** While nothing changes, a reminder this often. */
const HEARTBEAT_MS = 1000

let open = false
let latest: VideoSync = { seconds: 0, playing: false, rate: 1 }
let sent: { at: number; sync: VideoSync } | null = null
const listeners = new Set<() => void>()
let listening = false

function setOpen(next: boolean) {
	if (open === next) return
	open = next
	for (const listener of listeners) listener()
}

function send(sync: VideoSync) {
	sent = { at: performance.now(), sync }
	void emitTo(VIDEO_WINDOW_LABEL, VIDEO_SYNC_EVENT, sync).catch(() => {
		/* the window is closing */
	})
}

function ensureListeners() {
	if (listening) return
	listening = true
	void Promise.all([
		listen(CLOSED_EVENT, () => setOpen(false)),
		// A freshly loaded window missed the messages sent before it was ready.
		listen(VIDEO_READY_EVENT, () => open && send(latest)),
	]).catch(() => {
		listening = false
	})
}

export async function openVideoWindow(path: string, title: string) {
	ensureListeners()
	await invoke('video_window_open', { path, title })
	setOpen(true)
	send(latest)
}

export async function closeVideoWindow() {
	if (!open) return
	setOpen(false)
	await invoke('video_window_close').catch((error) => console.error('closing the video window:', error))
}

/** Called by the main player on every position report; sends only what the copy needs. */
export function syncVideoWindow(sync: VideoSync) {
	latest = sync
	if (!open) return
	const now = performance.now()
	if (!sent) return send(sync)
	const before = sent.sync
	const expected = before.seconds + (before.playing ? ((now - sent.at) / 1000) * before.rate : 0)
	const changed = before.playing !== sync.playing || before.rate !== sync.rate
	const jumped = Math.abs(expected - sync.seconds) > JUMP_SECONDS
	if (changed || jumped || (sync.playing && now - sent.at >= HEARTBEAT_MS)) send(sync)
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function useVideoWindowOpen(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => open,
		() => false,
	)
}

/** Tests: a closed window and no history. */
export function resetVideoWindow() {
	open = false
	sent = null
	latest = { seconds: 0, playing: false, rate: 1 }
	listening = false
}
