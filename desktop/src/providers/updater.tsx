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

/** Version whose update window already opened by itself; the same version never opens it again. */
export const UPDATE_PROMPTED_KEY = 'tyto.updatePrompted'

function readPromptedVersion() {
	try {
		return localStorage.getItem(UPDATE_PROMPTED_KEY)
	} catch {
		return null
	}
}

function writePromptedVersion(version: string) {
	try {
		localStorage.setItem(UPDATE_PROMPTED_KEY, version)
	} catch {
		/* private mode: the window still opened only once in this session */
	}
}

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
	/**
	 * The main screen says whether the window may open by itself now: true only there, with a model
	 * and with nothing transcribing, queued, recording or downloading. False everywhere else.
	 */
	setAutoPromptReady: (ready: boolean) => void
	/** «Проверить обновления» in General settings: asks the server now and opens the window when there is one. */
	checkNow: () => Promise<'found' | 'none' | 'error'>
}

// Create the context
export const UpdaterContext = createContext<UpdaterContextType>({
	availableUpdate: false,
	setAvailableUpdate: () => {},
	updating: false,
	setUpdating: () => {},
	setManifest: () => {},
	updateApp: async () => {},
	checkNow: async () => 'none',
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
	setAutoPromptReady: () => {},
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

	/** Fake mode walked through to «Готово»: the icon goes away for this session, as after a real install. */
	const [fakeDone, setFakeDone] = useState(false)
	/** Set between «Обновить» and the end of the run, so a double click starts one download. */
	const startingRef = useRef(false)
	const [autoPromptReady, setAutoPromptReady] = useState(false)
	const autoPromptedRef = useRef(false)

	function setFakeUpdate(value: boolean) {
		setFakeUpdateState(value)
		setFakeDone(false)
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

	// Opens the window by itself once per version, only for a real update (the fake one waits for a
	// click), and only when the main screen says nothing is running. If the app is busy when the
	// check answers, this fires on the next idle moment of the same session.
	useEffect(() => {
		if (autoPromptedRef.current || !update || !autoPromptReady || phase !== 'idle') return
		if (readPromptedVersion() === update.version) {
			autoPromptedRef.current = true
			return
		}
		autoPromptedRef.current = true
		writePromptedVersion(update.version)
		setPhase('confirm')
	}, [update, autoPromptReady, phase])

	function onDownloadEvent(downloadEvent: DownloadEvent) {
		switch (downloadEvent.event) {
			case 'Started': {
				// Some servers send `contentLength: 0`; that means "unknown", not an empty file.
				const length = downloadEvent.data.contentLength
				setTotal(length && length > 0 ? length : null)
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
		if (phase !== 'confirm' || startingRef.current) return
		startingRef.current = true
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
		} finally {
			startingRef.current = false
		}
	}

	function finishWindow() {
		startingRef.current = false
		setAvailableUpdate(false)
		if (isFake) setFakeDone(true)
		setPhase('idle')
	}

	function dismissUpdate() {
		if (phase === 'done') {
			finishWindow()
			return
		}
		setPhase('idle')
	}

	async function relaunchApp() {
		console.info('relaunch....')
		// Dev mode: nothing was installed, so a relaunch would only restart the dev app.
		const fake = isFake
		finishWindow()
		if (fake) return
		try {
			await process.relaunch()
		} catch (e) {
			console.error(e)
			setErrorModal?.({ open: true, log: String(e) })
		}
	}

	async function checkNow(): Promise<'found' | 'none' | 'error'> {
		try {
			const found = await checkUpdate()
			if (!found) return 'none'
			setAvailableUpdate(found.available)
			setUpdate(found)
			return 'found'
		} catch (error) {
			console.error(error)
			return 'error'
		}
	}

	return (
		<UpdaterContext.Provider
			value={{
				checkNow,
				availableUpdate: availableUpdate || (fakeUpdate && !fakeDone),
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
				setAutoPromptReady,
			}}>
			{children}
		</UpdaterContext.Provider>
	)
}
