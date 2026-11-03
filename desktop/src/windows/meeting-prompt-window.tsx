import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { CONFIG_KEYS } from '~/lib/config-keys'
import { readConfig } from '~/lib/config-store'
import {
	dismissMeetingPrompt,
	getMeetingPromptState,
	meetingPromptReady,
	type MeetingPromptState,
	type MeetingRecordingOptions,
	type MeetingSource,
} from '~/lib/meeting-prompt'
import { supportedLanguages } from '~/lib/i18n'
import { getCaptureSupport } from '~/lib/tyto/screen-recording'
import { m } from '~/paraglide/messages.js'
import { getLocale, getTextDirection, setLocale } from '~/paraglide/runtime.js'
import { OwlMark } from '~/lib/tyto/owl-mark'

const serviceNames: Record<MeetingSource, () => string> = {
	meet: () => 'Google Meet',
	zoom: () => 'Zoom',
	teams: () => 'Microsoft Teams',
	telemost: () => 'Яндекс Телемост',
	bitrix24: () => 'Битрикс24',
	// A browser has held the microphone for a while, the service is not known.
	browser: () => m.tytoMeetingRowBrowser(),
}

/** Both sides of the call: the person's microphone and what the others say. */
const BOTH_SOURCES: MeetingRecordingOptions = { microphone: true, systemAudio: true }

export default function MeetingPromptWindow() {
	const configuredLocale = readConfig(CONFIG_KEYS.displayLanguage, 'en-US')
	if (supportedLanguages[configuredLocale] && configuredLocale !== getLocale()) {
		setLocale(configuredLocale as never, { reload: false })
	}

	const [state, setState] = useState<MeetingPromptState | null>(null)
	const [busy, setBusy] = useState(false)
	const [videoSupported, setVideoSupported] = useState(false)
	const theme = readConfig<'light' | 'dark'>(CONFIG_KEYS.theme, window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
	const direction = getTextDirection(configuredLocale)

	useLayoutEffect(() => {
		document.title = m.appTitle()
		document.body.dir = direction
		document.documentElement.classList.toggle('dark', theme === 'dark')
		document.documentElement.classList.add('meeting-prompt-window')
		document.documentElement.style.background = 'transparent'
		document.body.style.background = 'transparent'
		void getCurrentWebviewWindow()
			.setTheme(theme)
			.catch(() => undefined)
		return () => {
			document.documentElement.classList.remove('meeting-prompt-window')
			document.documentElement.style.removeProperty('background')
			document.body.style.removeProperty('background')
		}
	}, [direction, theme])

	useEffect(() => {
		// «С видео» only where video capture works (macOS 13+, a working encoder).
		getCaptureSupport()
			.then((support) => setVideoSupported(support.video))
			.catch(() => setVideoSupported(false))
	}, [])

	useEffect(() => {
		let cancelled = false
		const unlisten = listen<MeetingPromptState>('meeting-prompt-state', ({ payload }) => {
			if (!cancelled) setState(payload)
		})
		void (async () => {
			try {
				const initialState = await getMeetingPromptState()
				if (!cancelled) setState(initialState)
			} catch (error) {
				console.error('Failed to initialize meeting prompt:', error)
			}
			await meetingPromptReady().catch((error) => console.error('Failed to mark meeting prompt ready:', error))
		})()
		return () => {
			cancelled = true
			unlisten.then((dispose) => dispose())
		}
	}, [])

	useEffect(() => {
		const unlisten = listen<{ started: boolean }>('meeting-prompt-recording-result', ({ payload }) => {
			setBusy(false)
			if (payload.started) setState(null)
		})
		return () => {
			unlisten.then((dispose) => dispose())
		}
	}, [])

	useEffect(() => {
		if (!state) return
		const timeout = window.setTimeout(() => {
			void dismissMeetingPrompt()
				.catch((error) => console.error('Failed to auto-dismiss meeting prompt:', error))
				.finally(() => setState(null))
		}, 10_000)
		return () => window.clearTimeout(timeout)
	}, [state])

	async function dismiss() {
		if (busy) return
		setBusy(true)
		try {
			await dismissMeetingPrompt()
			setState(null)
		} catch (error) {
			console.error('Failed to dismiss meeting prompt:', error)
			setBusy(false)
		}
	}

	async function startRecording(mode: 'audio' | 'video') {
		if (busy || !state) return
		setBusy(true)
		try {
			await emit('meeting-prompt-start-recording', { ...BOTH_SOURCES, mode, source: state.source })
		} catch (error) {
			console.error('Failed to start recording from meeting prompt:', error)
			setBusy(false)
		}
	}

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') void dismiss()
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	})

	if (!state) return null

	return (
		// A dark row like a system notification, the same in both themes: it sits over other apps.
		<div className="flex h-screen w-screen items-center justify-center bg-transparent p-2">
			<section className="tyto-meeting-row">
				<OwlMark className="tyto-meeting-row-owl" />
				<div className="min-w-0 flex-1">
					<h1 className="tyto-meeting-row-title">{m.tytoMeetingRowTitle({ source: serviceNames[state.source]() })}</h1>
					<p className="tyto-meeting-row-sub">{m.tytoMeetingRowSources()}</p>
				</div>
				<button type="button" className="tyto-meeting-row-primary" disabled={busy} onClick={() => void startRecording('audio')}>
					{m.tytoMeetingRowRecord()}
				</button>
				{videoSupported && (
					<button type="button" className="tyto-meeting-row-secondary" disabled={busy} onClick={() => void startRecording('video')}>
						{m.tytoMeetingRowVideo()}
					</button>
				)}
				<button
					type="button"
					className="tyto-meeting-row-close"
					disabled={busy}
					onClick={() => void dismiss()}
					aria-label={m.meetingPromptDismiss()}
					title={m.meetingPromptDismiss()}>
					<X className="h-4 w-4" />
				</button>
			</section>
		</div>
	)
}
