import { listen } from '@tauri-apps/api/event'
import * as fs from '@tauri-apps/plugin-fs'
import { AnimatePresence, motion } from 'framer-motion'
import { Link2, Pause, Play, Plus, Square, X } from 'lucide-react'
import { siFacebook, siInstagram, siTiktok, siX, siYoutube } from 'simple-icons'
import { useEffect, useRef, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import AudioDeviceInput from '~/components/audio-device-input'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/style'
import { listTranscripts, readTranscript, resolveProjectAudio, TRANSCRIPTS_CHANGED_EVENT, type TranscriptEntry } from '~/lib/transcripts-store'
import { CaptureTargetDialog } from '~/lib/tyto/capture-target-dialog'
import { EmptyScreen } from '~/lib/tyto/empty-screen'
import { loadRecordMeta } from '~/lib/tyto/recents-duration'
import { ensureScreenRecordingPermission } from '~/lib/tyto/screen-permission'
import { getCaptureSupport } from '~/lib/tyto/screen-recording'
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

/**
 * «Записать звонок» (design round C): one card with the sources line, «Записывать экран» as a switch
 * and «Начать запись». The devices fold away under «Устройства». While recording, the same card
 * shows the meter, the clock, pause and stop.
 */
export function RecordCard() {
	const { recording, recordElapsed, preference } = useSession()
	const [videoSupported, setVideoSupported] = useState(false)
	const [pickingTarget, setPickingTarget] = useState(false)
	const [withScreen, setWithScreen] = useState(false)
	const [devicesOpen, setDevicesOpen] = useState(false)

	useEffect(() => {
		// The recording hook loads audio devices for this tab only.
		preference.setHomeTab('record')
	}, [])

	useEffect(() => {
		// Builds without video capture show no screen switch.
		getCaptureSupport()
			.then((support) => setVideoSupported(support.video))
			.catch((error) => console.error('getCaptureSupport error: ', error))
	}, [])

	const cannotStart = !preference.modelPath || (!recording.inputDevice && !recording.outputDevice)

	function start() {
		// On a Mac the list of screens and windows needs Screen Recording first.
		if (videoSupported && withScreen) void ensureScreenRecordingPermission().then((ok) => ok && setPickingTarget(true))
		else void recording.startRecord('audio')
	}

	return (
		<section className="tyto-home-card" aria-labelledby="tyto-record-card-title">
			<div>
				<h2 id="tyto-record-card-title" className="tyto-home-card-title">
					{m.tytoRecordCardTitle()}
				</h2>
				{!recording.isRecording && (
					<p className="tyto-home-card-lead">
						{m.tytoRecordCardSources()}
						<span aria-hidden> · </span>
						<button type="button" aria-expanded={devicesOpen} onClick={() => setDevicesOpen((open) => !open)} className="tyto-link-button">
							{m.tytoRecordDevices()}
						</button>
					</p>
				)}
			</div>

			{recording.isRecording ? (
				<>
					<div className="flex items-center gap-3">
						<LevelMeter />
						<span className="font-mono text-2xl tracking-tight tabular-nums">{formatElapsed(recordElapsed)}</span>
					</div>
					<div className="flex w-full gap-2">
						<Button
							variant="secondary"
							disabled={recording.isFinishing}
							onClick={() => (recording.isPaused ? recording.resumeRecord() : recording.pauseRecord())}
							className="h-10 flex-1">
							{recording.isPaused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
							{recording.isPaused ? m.tytoRecordingResume() : m.tytoRecordingPause()}
						</Button>
						<Button disabled={recording.isFinishing} onClick={() => recording.stopRecord()} className="h-10 flex-1">
							<Square className="h-3.5 w-3.5 fill-current" />
							{recording.isFinishing ? m.tytoRecordingSaving() : m.stopRecording()}
						</Button>
					</div>
				</>
			) : (
				<>
					{devicesOpen && (
						// Device labels become eyebrows and the triggers drop to h-9 so the card stays compact.
						<div
							className={cn(
								'grid grid-cols-1 gap-3 [&>div]:space-y-1.5 [&_button]:h-9 [&_button]:rounded-[var(--tyto-r-md)]',
								'[&_label]:text-[12px] [&_label]:font-medium [&_label]:tracking-normal [&_label]:text-muted-foreground',
							)}>
							<AudioDeviceInput type="input" devices={recording.devices} device={recording.inputDevice} setDevice={recording.setInputDevice} />
							<AudioDeviceInput type="output" devices={recording.devices} device={recording.outputDevice} setDevice={recording.setOutputDevice} />
						</div>
					)}
					{videoSupported && (
						<label className="tyto-home-switch-row">
							<span className="min-w-0 flex-1">
								<span className="block text-[13.5px] font-medium">{m.tytoRecordScreen()}</span>
								<span className="block text-[12px] text-muted-foreground">{m.tytoRecordScreenInfo()}</span>
							</span>
							<Switch checked={withScreen} onCheckedChange={setWithScreen} aria-label={m.tytoRecordScreen()} />
						</label>
					)}
					<Button onClick={start} disabled={cannotStart} className="h-10 w-full">
						<span aria-hidden className="tyto-rec-dot" />
						{m.tytoRecordStart()}
					</Button>
				</>
			)}
			<CaptureTargetDialog
				open={pickingTarget}
				onCancel={() => setPickingTarget(false)}
				onStart={(target) => {
					setPickingTarget(false)
					void recording.startRecord('video', target)
				}}
			/>
		</section>
	)
}

/** How many recordings «Ждут расшифровки» lists; the rest stay in the sidebar. */
const WAITING_LIMIT = 3
/** How many of the newest projects are checked for a missing transcript. */
const WAITING_SCAN = 20

/** Saved projects without a transcript (recordings, mostly), newest first, with «Расшифровать». */
function WaitingList({ entries }: { entries: TranscriptEntry[] }) {
	const { queue, preference } = useSession()
	const [waiting, setWaiting] = useState<{ entry: TranscriptEntry; duration: number | null }[]>([])

	useEffect(() => {
		let alive = true
		const newest = entries.slice(0, WAITING_SCAN)
		void Promise.all(newest.map((entry) => loadRecordMeta(entry.path).then((meta) => ({ entry, meta })))).then((rows) => {
			if (!alive) return
			setWaiting(
				rows
					.filter((row) => row.meta?.untranscribed)
					.slice(0, WAITING_LIMIT)
					.map((row) => ({ entry: row.entry, duration: row.meta?.duration ?? null })),
			)
		})
		return () => {
			alive = false
		}
	}, [entries])

	async function transcribe(entry: TranscriptEntry) {
		const record = await readTranscript(entry.path)
		if (!record) return
		let source: string | null = null
		try {
			if (record.sourcePath && (await fs.exists(record.sourcePath))) source = record.sourcePath
		} catch (error) {
			console.warn('failed to check source file:', error)
		}
		source ??= await resolveProjectAudio(entry.path, record)
		if (!source) return
		queue.enqueue([{ name: entry.name, path: source, projectName: entry.name }])
	}

	if (waiting.length === 0) return null
	return (
		<section className="tyto-home-waiting" aria-labelledby="tyto-waiting-title">
			<h3 id="tyto-waiting-title" className="tyto-home-waiting-title">
				{m.tytoWaitingTitle()}
			</h3>
			<ul>
				{waiting.map(({ entry, duration }) => (
					<li key={entry.path} className="tyto-home-waiting-row">
						<span className="min-w-0 flex-1 truncate text-[14px] font-medium">{entry.name}</span>
						{duration ? <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{formatClock(duration)}</span> : null}
						<Button variant="secondary" size="sm" disabled={queue.running || !preference.modelPath} onClick={() => void transcribe(entry)}>
							{m.transcribe()}
						</Button>
					</li>
				))}
			</ul>
		</section>
	)
}

/** «0:12», «42:10», «1:04:33». */
function formatClock(seconds: number) {
	const total = Math.max(0, Math.round(seconds))
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const rest = String(total % 60).padStart(2, '0')
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
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

/** Saved projects, kept fresh: the welcome shows only while there are none. */
function useProjectEntries() {
	const { preference } = useSession()
	const [entries, setEntries] = useState<TranscriptEntry[] | null>(null)
	useEffect(() => {
		let alive = true
		const refresh = () =>
			void listTranscripts(preference.projectsPath).then((found) => {
				if (alive) setEntries(found)
			})
		refresh()
		window.addEventListener(TRANSCRIPTS_CHANGED_EVENT, refresh)
		return () => {
			alive = false
			window.removeEventListener(TRANSCRIPTS_CHANGED_EVENT, refresh)
		}
	}, [preference.projectsPath])
	return entries
}

export default function IdleHero() {
	const { dragging, browse, collectingFolder, panel, setPanel, link, recording } = useSession()
	const entries = useProjectEntries()

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
			// Until the list is read, the short labels: a returning user must not flash the welcome.
			firstRun={entries !== null && entries.length === 0}
			panel={panel}
			onBrowse={() => void browse()}
			onSelectPanel={selectPanel}
			recordCard={<RecordCard />}
			linkContent={<LinkPanel />}
			waiting={entries && entries.length > 0 ? <WaitingList entries={entries} /> : null}
			options={<QuietRow />}
		/>
	)
}
