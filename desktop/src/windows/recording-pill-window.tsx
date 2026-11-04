import { resolveTheme } from '~/lib/tyto/theme-choice'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useEffect, useLayoutEffect, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { CONFIG_KEYS } from '~/lib/config-keys'
import { readConfig } from '~/lib/config-store'
import { supportedLanguages } from '~/lib/i18n'
import { cn } from '~/lib/style'
import { OwlMark } from '~/lib/tyto/owl-mark'
import { displayElapsed, formatElapsed } from '~/lib/tyto/pill-time'
import {
	onRecordingFailed,
	onRecordingFinished,
	onRecordingState,
	pauseRecording,
	recordingPillReady,
	type RecordingState,
	resumeRecording,
	stopRecording,
} from '~/lib/tyto/screen-recording'
import { m } from '~/paraglide/messages.js'
import { getLocale, getTextDirection, setLocale } from '~/paraglide/runtime.js'

type Received = { state: RecordingState; at: number }

/**
 * The floating pill shown during any recording (Rust `screen::pill`): owl, a red dot blinking while
 * recording, the timer without pauses, «Пауза» / «Продолжить» and «Стоп». Everything but the
 * buttons is a drag region, so the pill can be moved by any point of it.
 */
export default function RecordingPillWindow() {
	const configuredLocale = readConfig(CONFIG_KEYS.displayLanguage, 'en-US')
	if (supportedLanguages[configuredLocale] && configuredLocale !== getLocale()) {
		setLocale(configuredLocale as never, { reload: false })
	}

	const [received, setReceived] = useState<Received | null>(null)
	const [now, setNow] = useState(() => Date.now())
	const [busy, setBusy] = useState(false)
	const theme = resolveTheme(readConfig<string>(CONFIG_KEYS.theme, 'system'))
	const direction = getTextDirection(configuredLocale)

	useLayoutEffect(() => {
		document.title = m.appTitle()
		document.body.dir = direction
		document.documentElement.classList.toggle('dark', theme === 'dark')
		document.documentElement.classList.add('recording-pill-window')
		document.documentElement.style.background = 'transparent'
		document.body.style.background = 'transparent'
		document.body.style.overflow = 'hidden'
		void getCurrentWebviewWindow()
			.setTheme(theme)
			.catch(() => undefined)
		return () => {
			document.documentElement.classList.remove('recording-pill-window')
			document.documentElement.style.removeProperty('background')
			document.body.style.removeProperty('background')
			document.body.style.removeProperty('overflow')
		}
	}, [direction, theme])

	useEffect(() => {
		let cancelled = false
		const unlisteners = [
			onRecordingState((state) => {
				if (!cancelled) setReceived({ state, at: Date.now() })
			}),
			onRecordingFinished(() => setReceived(null)),
			onRecordingFailed(() => setReceived(null)),
		]
		void recordingPillReady()
			.then((state) => {
				// An event may already have brought a newer state.
				if (!cancelled && state) setReceived((current) => current ?? { state, at: Date.now() })
			})
			.catch((error) => console.error('Failed to mark the recording pill ready:', error))
		return () => {
			cancelled = true
			for (const unlisten of unlisteners) unlisten.then((dispose) => dispose())
		}
	}, [])

	const status = received?.state.status
	useEffect(() => {
		if (status !== 'recording') return
		const interval = window.setInterval(() => setNow(Date.now()), 250)
		return () => window.clearInterval(interval)
	}, [status])

	if (!received) return null

	const { state, at } = received
	const finishing = state.status === 'finishing'
	const paused = state.status === 'paused'
	const elapsed = formatElapsed(displayElapsed(state, at, Math.max(now, at)))

	async function run(action: () => Promise<void>, what: string) {
		if (busy) return
		setBusy(true)
		try {
			await action()
		} catch (error) {
			console.error(`Recording pill: ${what} failed:`, error)
		} finally {
			setBusy(false)
		}
	}

	const pauseLabel = paused ? m.tytoPillResume() : m.tytoPillPause()

	// Variant A (design round 7): owl, red dot, the time in mono, then pause and stop as icons whose
	// names show on hover. Light or dark like the app (the theme is read above).
	return (
		<div data-tauri-drag-region className="flex h-screen w-screen items-center justify-center bg-transparent p-1">
			<section
				data-tauri-drag-region
				aria-label={m.recordingControls()}
				className="flex h-full w-full items-center gap-2.5 rounded-full border border-border bg-card ps-3.5 pe-1.5 text-card-foreground shadow-lg select-none">
				<span data-tauri-drag-region className="flex shrink-0 items-center">
					<OwlMark className="pointer-events-none h-5 w-auto text-foreground" />
				</span>
				{!finishing && (
					<span
						data-tauri-drag-region
						data-testid="recording-dot"
						data-blinking={state.status === 'recording'}
						className={cn(
							'h-[9px] w-[9px] shrink-0 rounded-full bg-[#ff5b4f]',
							state.status === 'recording' ? 'motion-safe:animate-pulse' : 'opacity-60',
						)}
					/>
				)}
				<span
					data-tauri-drag-region
					data-testid="recording-pill-label"
					aria-live="polite"
					className={cn('min-w-0 flex-1 truncate', finishing ? 'text-xs text-muted-foreground' : 'font-mono text-[14px] tabular-nums')}>
					{finishing ? m.tytoPillSaving() : elapsed}
				</span>
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						aria-label={pauseLabel}
						title={pauseLabel}
						disabled={busy || finishing}
						onClick={() => void (paused ? run(resumeRecording, 'resume') : run(pauseRecording, 'pause'))}
						className="tyto-pill-icon">
						{paused ? <Play aria-hidden className="h-3.5 w-3.5 fill-current" /> : <Pause aria-hidden className="h-3.5 w-3.5 fill-current" />}
					</button>
					<button
						type="button"
						aria-label={m.tytoPillStopLong()}
						title={m.tytoPillStopLong()}
						disabled={busy || finishing}
						onClick={() => void run(stopRecording, 'stop')}
						className="tyto-pill-icon tyto-pill-stop">
						<span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-[#ff5b4f]" />
					</button>
				</div>
			</section>
		</div>
	)
}
