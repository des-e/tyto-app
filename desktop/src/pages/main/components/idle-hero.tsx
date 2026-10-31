import { listen } from '@tauri-apps/api/event'
import { AnimatePresence, motion } from 'framer-motion'
import { Link2, Mic, Plus, Square, X } from 'lucide-react'
import { siFacebook, siInstagram, siTiktok, siX, siYoutube } from 'simple-icons'
import { useEffect, useRef, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import AudioDeviceInput from '~/components/audio-device-input'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/style'
import { EmptyScreen } from '~/lib/tyto/empty-screen'
import { parseMediaLinks } from '~/lib/ytdlp'
import { useSession, type IdlePanel } from '../session'
import QuietRow from './quiet-row'

function formatElapsed(seconds: number) {
	const minutes = Math.floor(seconds / 60)
	return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

// Live capture meter — five hairline bars driven by the backend's `record_level` event
// (a 0..1 peak, throttled to ~10/s). Center bars react hardest so the shape reads as a voice.
const BAR_WEIGHTS = [0.5, 0.78, 1, 0.78, 0.5]
const BAR_MIN_HEIGHT = 6
const BAR_MAX_HEIGHT = 18
/** Below this the capture counts as silence. */
const SILENCE_LEVEL = 0.03
/** How long silence must hold before the meter drops to dim stubs. */
const SILENCE_HOLD_MS = 1000
const METER_TICK_MS = 60
/** No event for this long means the stream stalled — let the target fall back to zero. */
const LEVEL_STALE_MS = 160

function LevelMeter() {
	const [level, setLevel] = useState(0)
	const [silent, setSilent] = useState(false)
	// Refs keep the audio-rate values out of the render path; only the smoothed level is state.
	const targetRef = useRef(0)
	const lastEventRef = useRef(Date.now())
	const lastSoundRef = useRef(Date.now())

	useEffect(() => {
		const unlisten = listen<number>('record_level', ({ payload }) => {
			const next = typeof payload === 'number' && Number.isFinite(payload) ? Math.min(Math.max(payload, 0), 1) : 0
			targetRef.current = next
			lastEventRef.current = Date.now()
			if (next > SILENCE_LEVEL) lastSoundRef.current = Date.now()
		})

		const timer = window.setInterval(() => {
			const now = Date.now()
			// A dead device emits nothing at all — decay so it can't freeze mid-bar.
			if (now - lastEventRef.current > LEVEL_STALE_MS) targetRef.current *= 0.6
			// Fast attack, slower release: peaks stay legible, the fall stays calm.
			setLevel((prev) => {
				const target = targetRef.current
				const eased = prev + (target - prev) * (target > prev ? 0.7 : 0.3)
				return Math.abs(eased - target) < 0.004 ? target : eased
			})
			setSilent(now - lastSoundRef.current > SILENCE_HOLD_MS)
		}, METER_TICK_MS)

		return () => {
			window.clearInterval(timer)
			unlisten.then((fn) => fn())
		}
	}, [])

	return (
		<span aria-hidden className={cn('flex h-[18px] items-center gap-[3px]', silent && 'opacity-40')}>
			{BAR_WEIGHTS.map((weight, index) => (
				<span
					key={index}
					className="w-[2px] rounded-full bg-foreground transition-[height] duration-75 ease-out"
					style={{ height: silent ? BAR_MIN_HEIGHT : BAR_MIN_HEIGHT + level * weight * (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT) }}
				/>
			))}
		</span>
	)
}

function RecordPanel() {
	const { recording, recordElapsed, preference } = useSession()

	useEffect(() => {
		// The recording hook loads audio devices for this tab only.
		preference.setHomeTab('record')
	}, [])

	if (recording.isRecording) {
		return (
			<div className="flex flex-col items-center gap-4 py-2.5">
				<div className="flex items-center gap-3">
					<LevelMeter />
					<span className="font-mono text-2xl tracking-tight tabular-nums">{formatElapsed(recordElapsed)}</span>
				</div>
				<Button onClick={() => recording.stopRecord()} className="h-10 w-full">
					<Square className="h-3.5 w-3.5 fill-current" />
					{m.stopRecording()}
				</Button>
			</div>
		)
	}

	return (
		// Device labels become eyebrows and the triggers drop to h-10 so the panel stays a compact
		// tool row instead of a form. Restyled from here to keep AudioDeviceInput's API untouched.
		<div
			className={cn(
				'flex w-full flex-col gap-5 py-2.5',
				// The .tyto-eyebrow look (12 px, 500, muted, normal case) on labels this file does not own.
				'[&_label]:text-[12px] [&_label]:font-medium [&_label]:tracking-normal [&_label]:text-muted-foreground',
			)}>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>div]:space-y-1.5 [&_button]:h-10 [&_button]:rounded-[var(--tyto-r-md)]">
				<AudioDeviceInput type="input" devices={recording.devices} device={recording.inputDevice} setDevice={recording.setInputDevice} />
				<AudioDeviceInput type="output" devices={recording.devices} device={recording.outputDevice} setDevice={recording.setOutputDevice} />
			</div>
			<Button
				onClick={() => recording.startRecord()}
				disabled={!preference.modelPath || (!recording.inputDevice && !recording.outputDevice)}
				className="h-10 w-full">
				<Mic className="h-4 w-4" />
				{m.startRecord()}
			</Button>
		</div>
	)
}

// Bundled monochrome brand marks of the most-used yt-dlp sources — fills the panel with a
// "works with" row instead of dead space. Rendered tiny and muted so it stays quiet.
const linkSources: { title: string; path: string }[] = [
	{ title: siYoutube.title, path: siYoutube.path },
	{ title: siTiktok.title, path: siTiktok.path },
	{ title: siInstagram.title, path: siInstagram.path },
	{ title: siX.title, path: siX.path },
	{ title: siFacebook.title, path: siFacebook.path },
]

function LinkPanel() {
	const { link, preference } = useSession()

	if (link.downloadingAudio) {
		const percent = link.ytdlpProgress ?? 0
		// yt-dlp reports nothing until the stream starts; show motion rather than a stuck 0%.
		const started = percent > 0
		return (
			<div className="flex w-full flex-col items-center gap-4 py-2.5">
				<span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-background/70 text-foreground shadow-sm">
					<span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-foreground/5" />
					<Link2 className="h-5 w-5" />
				</span>

				<div className="w-full max-w-sm space-y-2">
					<div className="flex items-baseline justify-between gap-3">
						<span className="truncate text-[13px] font-medium text-foreground">{m.downloading({ progress: String(percent) })}</span>
						<span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">{started ? `${percent}%` : '—'}</span>
					</div>

					<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
						{started ? (
							<div className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
						) : (
							// Indeterminate: a short bar sweeping the track while we wait for the first byte.
							<div className="download-sweep h-full w-1/3 rounded-full bg-foreground/70" />
						)}
					</div>

					{link.batch && (
						<p dir="ltr" className="truncate text-center text-[12px] text-muted-foreground">
							{link.batch.total > 1 && (
								<span className="me-2 font-medium text-muted-foreground">
									{m.linkOfTotal({ current: String(link.batch.index + 1), total: String(link.batch.total) })}
								</span>
							)}
							{link.batch.url}
						</p>
					)}
				</div>

				<Button
					variant="secondary"
					size="sm"
					onClick={() => link.cancelYtDlpDownload()}>
					{m.cancel()}
				</Button>
			</div>
		)
	}

	return (
		<motion.div layout className="flex w-full flex-col items-center gap-5 py-2.5">
			<motion.div layout="position" className="flex w-full items-center gap-3">
				<div className="relative min-w-0 flex-1">
					<Input
						type="text"
						value={link.audioUrl}
						onChange={(event) => link.setAudioUrl(event.target.value)}
						onKeyDown={(event) => (event.key === 'Enter' ? void link.downloadAudio() : null)}
						// Several links pasted together go straight into the list; one stays in the box.
						onPaste={(event) => {
							const pasted = event.clipboardData.getData('text')
							if (parseMediaLinks(pasted).length < 2) return
							event.preventDefault()
							link.queueLinks(`${link.audioUrl} ${pasted}`)
						}}
						// Short enough to stay fully readable when the window is narrow.
						placeholder={link.queuedLinks.length ? m.pasteAnotherLink() : m.pasteMediaLink()}
						className={cn('h-10 min-w-0 rounded-[var(--tyto-r-md)] px-3.5 text-sm', link.audioUrl && 'pe-10')}
					/>
					{/* The way to build a list by hand: park this link and type the next one. */}
					{link.audioUrl && (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									aria-label={m.addLink()}
									onClick={() => link.queueLinks()}
									className="absolute end-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[var(--tyto-r-sm)] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80">
									<Plus className="h-4 w-4" />
								</button>
							</TooltipTrigger>
							<TooltipContent>{m.addLink()}</TooltipContent>
						</Tooltip>
					)}
				</div>
				<Button
					onClick={() => link.downloadAudio()}
					disabled={!preference.modelPath || link.pendingLinks.length === 0}
					// Wide enough for the count, so the box beside it never changes size.
					className="h-10 w-32 shrink-0 px-4">
					{m.transcribe()}
					{link.pendingLinks.length > 1 && (
						<span className="rounded-[var(--tyto-r-xs)] bg-primary-foreground/20 px-1.5 text-[11px] font-semibold tabular-nums">{link.pendingLinks.length}</span>
					)}
				</Button>
			</motion.div>

			{/* Links waiting their turn, each removable until the run starts. The list keeps the */}
			{/* card's width and scrolls vertically once it holds more than a few, so nothing else */}
			{/* moves; rows slide in and out, and the card's own re-centring is animated with them. */}
			<AnimatePresence initial={false}>
				{link.queuedLinks.length > 0 && (
					<motion.ul key="queued-links" layout className="flex max-h-28 w-full flex-col gap-1 overflow-y-auto overscroll-contain">
						<AnimatePresence initial={false}>
							{link.queuedLinks.map((url) => (
								<motion.li
									key={url}
									layout
									initial={{ height: 0, opacity: 0 }}
									animate={{ height: 'auto', opacity: 1 }}
									exit={{ height: 0, opacity: 0 }}
									transition={{ duration: 0.18, ease: 'easeOut' }}
									className="group shrink-0 overflow-hidden rounded-[var(--tyto-r-sm)] text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-muted/60">
									<div className="flex items-center gap-2.5 px-2 py-1">
										<Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										<span dir="ltr" className="min-w-0 flex-1 truncate text-start text-foreground/90">
											{url}
										</span>
										<button
											type="button"
											aria-label={m.removeLink()}
											onClick={() => link.removeQueuedLink(url)}
											className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80">
											<X className="h-3.5 w-3.5" />
										</button>
									</div>
								</motion.li>
							))}
						</AnimatePresence>
					</motion.ul>
				)}
			</AnimatePresence>

			<motion.div layout="position" className="flex flex-col items-center gap-3">
				<p className="tyto-eyebrow">{m.worksWith()}</p>
				<div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-muted-foreground">
					{linkSources.map((source) => (
						<Tooltip key={source.title}>
							<TooltipTrigger asChild>
								<svg
									viewBox="0 0 24 24"
									aria-label={source.title}
									role="img"
									className="h-[18px] w-[18px] transition-colors duration-150 hover:text-foreground">
									<path d={source.path} fill="currentColor" />
								</svg>
							</TooltipTrigger>
							<TooltipContent side="bottom">{source.title}</TooltipContent>
						</Tooltip>
					))}
					<span className="text-[12px] text-muted-foreground">{m.moreSources()}</span>
				</div>
			</motion.div>
		</motion.div>
	)
}

export default function IdleHero() {
	const { dragging, browse, collectingFolder, panel, setPanel, link, recording } = useSession()

	function selectPanel(next: IdlePanel) {
		if (recording.isRecording || next === panel) return
		setPanel(next)
		if (next === 'link') void link.switchToLinkTab()
	}

	// Tyto: the empty screen layout lives in lib/tyto/empty-screen.tsx; the panels and the drop target stay upstream.
	return (
		<EmptyScreen
			dragging={dragging}
			collectingFolder={collectingFolder}
			panel={panel}
			onBrowse={() => void browse()}
			onSelectPanel={selectPanel}
			panelContent={panel === 'record' ? <RecordPanel /> : panel === 'link' ? <LinkPanel /> : null}
			options={<QuietRow />}
		/>
	)
}
