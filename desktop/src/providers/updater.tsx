import * as process from '@tauri-apps/plugin-process'
import { DownloadEvent, Update, check as checkUpdate } from '@tauri-apps/plugin-updater'
import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { ErrorModalContext } from './error-modal'
import { ModifyState } from '~/lib/types'
import { invoke } from '@tauri-apps/api/core'
// Define the context type

/** Dev-only: pretend an update is waiting so the update affordances can be eyeballed. */
export const FAKE_UPDATE_KEY = 'vibe_fake_update'
export const devToolsEnabled = import.meta.env.DEV

/** Steps of the one update window (components/update-window.tsx). `error` closes the window and opens the error modal. */
export type UpdatePhase = 'idle' | 'confirm' | 'downloading' | 'installing' | 'done' | 'error'

/** What the fake (dev mode) update pretends to download. */
export const FAKE_UPDATE_SIZE = 43e6
const FAKE_DOWNLOAD_MS = 5000

type UpdaterContextType = {
	availableUpdate: boolean
	setAvailableUpdate: ModifyState<boolean>
	updating: boolean
	setUpdating: ModifyState<boolean>
	manifest?: Update
	setManifest: ModifyState<Update | undefined>
	/** Opens the update window on its first step; the download starts from `startUpdate`. */
	updateApp: () => Promise<void>
	/** Percent of the download, null while the size is unknown or nothing is downloading. */
	progress: number | null
	/** Dev-only switch that fakes `availableUpdate`; always false in release builds. */
	fakeUpdate: boolean
	setFakeUpdate: (value: boolean) => void
	phase: UpdatePhase
	/** Bytes downloaded so far. */
	downloaded: number
	/** Size of the download, null when the server did not say. */
	total: number | null
	/** Version shown in the window: the real one, or a made-up one in fake mode. */
	version: string
	/** Release notes of the new version, may be empty. */
	notes: string
	startUpdate: () => Promise<void>
	/** «Позже»: closes the window, the update icon stays. */
	dismissUpdate: () => void
	relaunchApp: () => Promise<void>
}

// Create the context
export const UpdaterContext = createContext<UpdaterContextType>({
	availableUpdate: false,
	setAvailableUpdate: () => {},
	updating: false,
	setUpdating: () => {},
	setManifest: () => {},
	updateApp: async () => {},
	progress: null,
	fakeUpdate: false,
	setFakeUpdate: () => {},
	phase: 'idle',
	downloaded: 0,
	total: null,
	version: '',
	notes: '',
	startUpdate: async () => {},
	dismissUpdate: () => {},
	relaunchApp: async () => {},
})

export function UpdaterProvider({ children }: { children: React.ReactNode }) {
	const [availableUpdate, setAvailableUpdate] = useState(false)
	const [update, setUpdate] = useState<Update | undefined>()
	const [updating, setUpdating] = useState(false)
	const [phase, setPhase] = useState<UpdatePhase>('idle')
	const [downloaded, setDownloaded] = useState(0)
	const [total, setTotal] = useState<number | null>(null)
	const { setState: setErrorModal } = useContext(ErrorModalContext)
	const fakeTimers = useRef<ReturnType<typeof setInterval>[]>([])
	const [fakeUpdate, setFakeUpdateState] = useState(() => {
		if (!devToolsEnabled) return false
		try {
			return localStorage.getItem(FAKE_UPDATE_KEY) === '1'
		} catch {
			return false
		}
	})

	function setFakeUpdate(value: boolean) {
		setFakeUpdateState(value)
		try {
			localStorage.setItem(FAKE_UPDATE_KEY, value ? '1' : '0')
		} catch {
			/* private mode — the flag still holds for this session */
		}
	}

	const isFake = fakeUpdate && !update
	const progress = total ? Math.min(100, (downloaded / total) * 100) : null

	useEffect(() => {
		// Check for new updates
		async function checkForUpdates() {
			try {
				const newUpdate = await checkUpdate()
				if (newUpdate) {
					setAvailableUpdate(newUpdate?.available)
					setUpdate(newUpdate)
				}
			} catch (error) {
				console.error(error)
			}
		}
		checkForUpdates()
		return () => fakeTimers.current.forEach(clearInterval)
	}, [])

	function onDownloadEvent(downloadEvent: DownloadEvent) {
		switch (downloadEvent.event) {
			case 'Started': {
				setTotal(downloadEvent.data.contentLength ?? null)
				break
			}
			case 'Progress': {
				setDownloaded((prev) => prev + downloadEvent.data.chunkLength)
				break
			}
		}
	}

	function resetDownload() {
		setUpdating(false)
		setDownloaded(0)
		setTotal(null)
	}

	async function downloadAndInstall() {
		setUpdating(true)
		setDownloaded(0)
		setTotal(null)
		setPhase('downloading')
		console.info(`Installing update ${update?.version}, ${update?.date}, ${update?.body}`)
		await update?.download(onDownloadEvent)
		setPhase('installing')
		// Windows cannot replace the bundled server.exe while it is running. Stop it
		// only after the update has downloaded so transcription remains available
		// while the (potentially long) download is in progress.
		await invoke('stop_api_server')
		await update?.install()
		resetDownload()
		setPhase('done')
	}

	/** Dev mode: walk through downloading, installing and done on timers, nothing is downloaded. */
	function simulateUpdate() {
		setUpdating(true)
		setDownloaded(0)
		setTotal(FAKE_UPDATE_SIZE)
		setPhase('downloading')
		const startedAt = Date.now()
		const timer = setInterval(() => {
			const fraction = Math.min(1, (Date.now() - startedAt) / FAKE_DOWNLOAD_MS)
			setDownloaded(FAKE_UPDATE_SIZE * fraction)
			if (fraction < 1) return
			clearInterval(timer)
			setPhase('installing')
			const finish = setInterval(() => {
				clearInterval(finish)
				resetDownload()
				setPhase('done')
			}, 1500)
			fakeTimers.current.push(finish)
		}, 100)
		fakeTimers.current.push(timer)
	}

	async function updateApp() {
		if (phase !== 'idle') return
		if (!update && !fakeUpdate) return
		setPhase('confirm')
	}

	async function startUpdate() {
		if (isFake) {
			simulateUpdate()
			return
		}
		try {
			await downloadAndInstall()
		} catch (e) {
			console.error(e)
			resetDownload()
			// The window closes; the error modal carries the log.
			setPhase('idle')
			setErrorModal?.({ open: true, log: String(e) })
		}
	}

	function dismissUpdate() {
		if (phase === 'done') setAvailableUpdate(false)
		setPhase('idle')
	}

	async function relaunchApp() {
		console.info('relaunch....')
		setAvailableUpdate(false)
		setPhase('idle')
		await process.relaunch()
	}

	return (
		<UpdaterContext.Provider
			value={{
				availableUpdate: availableUpdate || fakeUpdate,
				setAvailableUpdate,
				fakeUpdate,
				setFakeUpdate,
				manifest: update,
				setManifest: setUpdate,
				updating,
				setUpdating,
				updateApp,
				progress,
				phase,
				downloaded,
				total,
				version: update?.version ?? (isFake ? '0.0.0' : ''),
				notes: update?.body?.trim() ?? '',
				startUpdate,
				dismissUpdate,
				relaunchApp,
			}}>
			{children}
		</UpdaterContext.Provider>
	)
}
