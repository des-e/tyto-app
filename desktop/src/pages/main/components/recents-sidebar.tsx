import { useVirtualizer } from '@tanstack/react-virtual'
import { invoke } from '@tauri-apps/api/core'
import * as pathApi from '@tauri-apps/api/path'
import * as dialog from '@tauri-apps/plugin-dialog'
import * as fs from '@tauri-apps/plugin-fs'
import { Download, MoreHorizontal, Plus, Search, Settings, Smartphone } from 'lucide-react'
import { type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/style'
import {
	deleteTranscript,
	listTranscripts,
	readTranscript,
	renameTranscript,
	resolveProjectAudio,
	TRANSCRIPTS_CHANGED_EVENT,
	type TranscriptEntry,
} from '~/lib/transcripts-store'

import { openSettingsSection } from '~/lib/app'
import { getVersionNumber } from '~/lib/logs'
import { FEATURES } from '~/lib/tyto/features'
import { FinishBlinkWordmark } from '~/lib/tyto/wordmark'
import { useMainAreaOffset } from '~/lib/tyto/main-area'
import { groupRecents, recentMeta, recentsGroupLabel, useNow } from '~/lib/tyto/recents-groups'
import { useRecordDuration } from '~/lib/tyto/recents-duration'
import { TOGGLE_SIDEBAR_EVENT } from '~/components/layout'
import { Button } from '~/components/ui/button'
import { getTextDirection } from '~/paraglide/runtime.js'
import { UpdaterContext } from '~/providers/updater'
import { useSession } from '../session'
import RetranscribeDialog from './retranscribe-dialog'
import type { Job } from '../hooks/use-transcribe-queue'

/** Resize bounds: never narrower than the rows need, never much wider than the default. */
const DEFAULT_WIDTH = 248
const MIN_WIDTH = 248
const MAX_WIDTH = 380
/**
 * Closing is a separate gesture from resizing: the panel stops following the pointer at MIN_WIDTH,
 * and only collapses once the pointer is dragged this close to the window edge — far enough past
 * the minimum that it can't happen by accident.
 */
const CLOSE_EDGE = 56
/** A recent row is two lines of text plus its padding; the virtualizer measures the real height after mount. */
const ROW_HEIGHT = 52
/** A day label: 16 px above, 4 px below a 12 px line. */
const LABEL_HEIGHT = 34
const WIDTH_STORAGE_KEY = 'vibe_sidebar_width'

function clampWidth(width: number) {
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))
}

/** Pointer-drag resize on the sidebar's trailing edge; the width survives a reload. */
function useResizableWidth() {
	const [width, setWidth] = useState(() => {
		try {
			const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY))
			return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : DEFAULT_WIDTH
		} catch {
			return DEFAULT_WIDTH
		}
	})
	const [dragging, setDragging] = useState(false)
	const start = useRef({ x: 0, width: DEFAULT_WIDTH })
	// Tracks the un-clamped width so we can tell "dragged well past the minimum" from "at the minimum".
	const raw = useRef(width)
	// The collapse fires mid-drag; this keeps a stray move event from toggling it straight back open.
	const collapsed = useRef(false)

	function persist(value: number) {
		try {
			window.localStorage.setItem(WIDTH_STORAGE_KEY, String(value))
		} catch {
			/* private mode — the width still holds for this session */
		}
	}

	function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
		if (event.button !== 0) return
		event.preventDefault()
		event.currentTarget.setPointerCapture(event.pointerId)
		start.current = { x: event.clientX, width }
		raw.current = width
		collapsed.current = false
		setDragging(true)
	}

	function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
		if (!dragging || collapsed.current) return
		// The panel is always docked to the window's left edge, so dragging right always widens it.
		raw.current = start.current.width + (event.clientX - start.current.x)
		// The panel stops moving at MIN_WIDTH; only a pointer dragged to the very window edge closes it.
		if (event.clientX < CLOSE_EDGE) {
			collapsed.current = true
			setDragging(false)
			if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
			// The width we reopen at stays untouched.
			window.dispatchEvent(new CustomEvent(TOGGLE_SIDEBAR_EVENT))
			return
		}
		setWidth(clampWidth(raw.current))
	}

	function endDrag(event: React.PointerEvent<HTMLDivElement>) {
		if (!dragging) return
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
		setDragging(false)
		persist(clampWidth(raw.current))
	}

	function onDoubleClick() {
		setWidth(DEFAULT_WIDTH)
		raw.current = DEFAULT_WIDTH
		persist(DEFAULT_WIDTH)
	}

	// While dragging, the whole window should show the resize cursor and stop selecting text.
	useEffect(() => {
		if (!dragging) return
		const previousCursor = document.body.style.cursor
		const previousSelect = document.body.style.userSelect
		document.body.style.cursor = 'col-resize'
		document.body.style.userSelect = 'none'
		return () => {
			document.body.style.cursor = previousCursor
			document.body.style.userSelect = previousSelect
		}
	}, [dragging])

	return { width, dragging, handleProps: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onDoubleClick } }
}

interface RowMenuState {
	/** media to re-transcribe: the original file, else the project folder's copy; null when neither */
	sourcePath: string | null
	sourceExists: boolean
}

function RecentRow({
	entry,
	now,
	active,
	disabled,
	onOpen,
	onDeleted,
	onRenamed,
}: {
	entry: TranscriptEntry
	now: Date
	active: boolean
	disabled: boolean
	onOpen: () => void
	onDeleted: () => void
	onRenamed: () => void
}) {
	const { queue } = useSession()
	const duration = useRecordDuration(entry.path)
	const [menu, setMenu] = useState<RowMenuState>({ sourcePath: null, sourceExists: false })
	const [renaming, setRenaming] = useState(false)
	const [retranscribing, setRetranscribing] = useState(false)
	const [draftName, setDraftName] = useState(entry.name)

	// The list is built from names only, so the media is located lazily — the first time the row's
	// menu opens — to decide whether "Re-transcribe" can do anything. The original file wins; the
	// project folder's copy keeps re-transcribing possible once the original is gone.
	const loadSource = useCallback(async () => {
		const record = await readTranscript(entry.path)
		if (!record) {
			setMenu({ sourcePath: null, sourceExists: false })
			return
		}
		let sourceExists = false
		try {
			sourceExists = !!record.sourcePath && (await fs.exists(record.sourcePath))
		} catch (error) {
			console.warn('failed to check source file:', error)
		}
		if (sourceExists) {
			setMenu({ sourcePath: record.sourcePath, sourceExists: true })
			return
		}
		const copy = await resolveProjectAudio(entry.path, record)
		setMenu({ sourcePath: copy ?? (record.sourcePath || null), sourceExists: !!copy })
	}, [entry.path])

	async function reveal() {
		try {
			await invoke('open_path', { path: await pathApi.dirname(entry.path) })
		} catch (error) {
			console.warn('failed to reveal transcript:', error)
		}
	}

	async function remove() {
		const confirmed = await dialog.ask(m.deleteTranscriptBody({ name: entry.name }), {
			title: m.deleteTranscript(),
			kind: 'warning',
		})
		if (!confirmed) return
		await deleteTranscript(entry.path)
		onDeleted()
	}

	function retranscribe() {
		if (!menu.sourcePath || !menu.sourceExists) return
		queue.enqueue([{ name: entry.name, path: menu.sourcePath, projectName: entry.name }])
	}

	async function commitRename() {
		const next = draftName.trim()
		setRenaming(false)
		if (!next || next === entry.name) return
		if (await renameTranscript(entry.path, next)) onRenamed()
	}

	if (renaming) {
		return (
			<div className="mb-0.5 flex items-center rounded-[var(--tyto-r-sm)] bg-muted px-1 py-1.5">
				<input
					autoFocus
					value={draftName}
					onChange={(event) => setDraftName(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') void commitRename()
						if (event.key === 'Escape') setRenaming(false)
					}}
					onBlur={() => void commitRename()}
					aria-label={m.transcriptName()}
					className="h-7 w-full min-w-0 rounded-[var(--tyto-r-sm)] border border-ring/40 bg-background px-[7px] text-[13.5px] text-foreground outline-none"
				/>
			</div>
		)
	}

	return (
		<div className={cn('tyto-recent group', active && 'tyto-recent-selected')}>
			<RetranscribeDialog open={retranscribing} onOpenChange={setRetranscribing} name={entry.name} onConfirm={retranscribe} />
			<button type="button" onClick={onOpen} disabled={disabled} title={entry.name} className="tyto-recent-main">
				<p className="tyto-recent-title truncate">{entry.name}</p>
				<p className="tyto-recent-meta truncate">{recentMeta(entry.createdAt, now, duration)}</p>
			</button>

			<DropdownMenu
				onOpenChange={(open) => {
					if (open) void loadSource()
				}}>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label={m.transcriptActions()}
						className={cn(
							'me-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[var(--tyto-r-sm)] text-muted-foreground transition-opacity duration-150',
							'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-foreground',
						)}>
						<MoreHorizontal className="h-4 w-4" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-48">
					<DropdownMenuItem disabled={disabled || !menu.sourceExists} onSelect={() => setRetranscribing(true)}>
						{m.reTranscribe()}
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => {
							setDraftName(entry.name)
							setRenaming(true)
						}}>
						{m.rename()}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => void reveal()}>{m.showInFolder()}</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void remove()}>
						{m.delete()}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}

/** One job from the running session — it shows up the moment it is queued, not when it is saved. */
function SessionRow({ job, active, onOpen }: { job: Job; active: boolean; onOpen: () => void }) {
	const percent = Math.round(job.progress)
	const status = job.status === 'queued' ? m.queued() : job.status === 'error' ? m.error() : job.status === 'cancelled' ? m.cancel() : ''

	return (
		<div className={cn('tyto-recent group', active && 'tyto-recent-selected')}>
			<button type="button" onClick={onOpen} title={job.name} className="tyto-recent-main">
				<p className="tyto-recent-title truncate">{job.name}</p>
				{job.status === 'running' ? (
					<div className="tyto-recent-run">
						<span className="tyto-recent-meta">{m.transcribingPercent({ percent: String(percent) })}</span>
						<div role="progressbar" aria-label={job.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="tyto-mini-progress">
							<div style={{ transform: `scaleX(${Math.min(Math.max(percent, 0), 100) / 100})` }} />
						</div>
					</div>
				) : (
					status && <p className="tyto-recent-meta truncate">{status}</p>
				)}
			</button>
		</div>
	)
}

/** One line of the windowed list: a day label, a job of the open session, or a saved transcript. */
type ListRow =
	| { kind: 'label'; key: string; label: string }
	| { kind: 'job'; key: string; job: Job }
	| { kind: 'entry'; key: string; entry: TranscriptEntry }

/**
 * The recents list, windowed: only the rows near the viewport are mounted, so a folder holding
 * hundreds of projects costs the same to render as one holding ten.
 */
function RecentsList({
	rows,
	now,
	activePath,
	activeName,
	selectedJobId,
	disabled,
	onOpen,
	onSelectJob,
	onChanged,
}: {
	rows: ListRow[]
	now: Date
	activePath: string | null
	activeName: string | null
	selectedJobId: string | null
	disabled: boolean
	onOpen: (entry: TranscriptEntry) => void
	onSelectJob: (id: string) => void
	onChanged: () => void
}) {
	const scrollRef = useRef<HTMLDivElement>(null)
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: (index) => (rows[index]?.kind === 'label' ? LABEL_HEIGHT : ROW_HEIGHT),
		getItemKey: (index) => rows[index]?.key ?? index,
		// A row grows when its name wraps, and shrinks while it is being renamed.
		measureElement: (element) => element.getBoundingClientRect().height,
		overscan: 8,
	})

	return (
		<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
			<div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
				{virtualizer.getVirtualItems().map((item) => {
					const row = rows[item.index]
					if (!row) return null
					let content: ReactNode
					if (row.kind === 'label') {
						content = <p className="tyto-group-label">{row.label}</p>
					} else if (row.kind === 'job') {
						content = <SessionRow job={row.job} active={row.job.id === selectedJobId} onOpen={() => onSelectJob(row.job.id)} />
					} else {
						const entry = row.entry
						const active = entry.path === activePath
						content = (
							<RecentRow
								entry={active && activeName ? { ...entry, name: activeName } : entry}
								now={now}
								active={active}
								disabled={disabled}
								onOpen={() => onOpen(entry)}
								onDeleted={onChanged}
								onRenamed={onChanged}
							/>
						)
					}
					return (
						<div
							key={item.key}
							ref={virtualizer.measureElement}
							data-index={item.index}
							className="absolute inset-x-0 top-0"
							style={{ transform: `translateY(${item.start}px)` }}>
							{content}
						</div>
					)
				})}
			</div>
		</div>
	)
}

export default function RecentsSidebar() {
	const { queue, startNew, preference } = useSession()
	const { updateApp, availableUpdate } = useContext(UpdaterContext)
	const { width, dragging, handleProps } = useResizableWidth()
	useMainAreaOffset(width)
	const [entries, setEntries] = useState<TranscriptEntry[]>([])
	const [query, setQuery] = useState('')

	const refresh = useCallback(() => {
		void listTranscripts(preference.projectsPath).then(setEntries)
	}, [preference.projectsPath])

	useEffect(() => {
		refresh()
		// Saves happen inside the queue; deletes happen in other rows. Both announce themselves.
		window.addEventListener(TRANSCRIPTS_CHANGED_EVENT, refresh)
		return () => window.removeEventListener(TRANSCRIPTS_CHANGED_EVENT, refresh)
	}, [refresh])

	// Jobs of the open session that the store does not know about yet (still queued, running, or
	// finished with saving switched off) — without them a new transcription looks like it went nowhere.
	const liveJobs = useMemo(() => queue.jobs.filter((job) => !job.savedPath && !job.hydrated), [queue.jobs])

	// Day groups move on at local midnight and when the window regains focus.
	const now = useNow()

	// One flat list for the virtualizer: a label row before each day group. Jobs of the open session
	// are happening now, so they head «Сегодня».
	const rows = useMemo(() => {
		const needle = query.trim().toLowerCase()
		const matches = (name: string) => !needle || name.toLowerCase().includes(needle)
		const items: ({ job: Job } | { entry: TranscriptEntry })[] = [
			...liveJobs.filter((job) => matches(job.name)).map((job) => ({ job })),
			...entries.filter((entry) => matches(entry.name)).map((entry) => ({ entry })),
		]
		const result: ListRow[] = []
		for (const group of groupRecents(items, (item) => ('job' in item ? now : item.entry.createdAt), now)) {
			result.push({ kind: 'label', key: `label:${group.key}`, label: recentsGroupLabel(group.key) })
			for (const item of group.items) {
				if ('job' in item) result.push({ kind: 'job', key: `job:${item.job.id}`, job: item.job })
				else result.push({ kind: 'entry', key: item.entry.path, entry: item.entry })
			}
		}
		return result
	}, [entries, liveJobs, now, query])

	const [version, setVersion] = useState('')
	useEffect(() => {
		getVersionNumber().then(
			(value) => setVersion(typeof value === 'string' ? value : ''),
			() => setVersion(''),
		)
	}, [])

	const activePath = queue.selectedJob?.savedPath ?? null

	async function open(entry: TranscriptEntry) {
		const record = await readTranscript(entry.path)
		if (!record) return
		// The folder entry is the canonical project title. Older records may still contain the
		// original media extension even though the sidebar and project folder do not.
		const projectRecord = record.name === entry.name ? record : { ...record, name: entry.name }
		// Resolved here rather than in the queue so `hydrate` stays synchronous.
		queue.hydrate(projectRecord, entry.path, await resolveProjectAudio(entry.path, record))
	}

	return (
		<aside className="tyto-sidebar relative flex h-full shrink-0 flex-col border-r border-border" style={{ width, direction: getTextDirection() }}>
			{/* Titlebar strip: hosts the toggle beside the macOS traffic lights (ChatGPT style). */}
			<div data-tauri-drag-region className="h-14 shrink-0" />
			{/* Codex-style: the wordmark gets its own row under the titlebar strip. */}
			<div className="mt-0.5 mb-2 flex h-[26px] items-center px-4">
				<FinishBlinkWordmark jobs={queue.jobs} className="h-[26px] w-auto shrink-0 select-none text-foreground" />
			</div>
			{/* Search on top (difference 5), whenever there is anything to search. */}
			{(entries.length > 0 || liveJobs.length > 0) && (
				<div className="relative px-2 pb-2">
					<Search className="pointer-events-none absolute start-4 top-4 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						autoComplete="off"
						autoCorrect="off"
						autoCapitalize="none"
						spellCheck={false}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={m.searchRecents()}
						aria-label={m.searchRecents()}
						className="h-8 w-full rounded-[var(--tyto-r-sm)] border border-border bg-background ps-[29px] pe-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground"
					/>
				</div>
			)}
			<div className="px-2">
				<Button variant="secondary" size="sm" onClick={startNew} className="w-full justify-start gap-2 px-2">
					<Plus className="text-muted-foreground" />
					{m.newTranscription()}
				</Button>
			</div>

			{rows.length === 0 ? (
				<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
					<p className="px-2 py-4 text-[13px] text-muted-foreground">{entries.length === 0 && liveJobs.length === 0 ? m.noRecentTranscripts() : m.noMatches()}</p>
				</div>
			) : (
				<RecentsList
					rows={rows}
					now={now}
					activePath={activePath}
					activeName={queue.selectedJob?.name ?? null}
					selectedJobId={queue.selectedId}
					// Loading another transcript mid-run would fight the queue for the view.
					disabled={queue.running}
					onOpen={(entry) => void open(entry)}
					onSelectJob={(id) => queue.selectJob(id)}
					onChanged={refresh}
				/>
			)}

			{/* Footer: «Настройки» and the version on the bottom strip shared with the player (.tyto-bar). */}
			<div className="tyto-bar px-2">
				<div className="flex min-w-0 flex-1 items-center gap-1">
					<Button variant="ghost" size="sm" onClick={() => openSettingsSection('')} className="gap-2 px-2">
						<Settings className="text-muted-foreground" />
						{m.settings()}
					</Button>
					{FEATURES.phone && <Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								aria-label={m.phone()}
								onClick={() => openSettingsSection('phone')}
								className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--tyto-r-md)] transition-colors duration-150 hover:bg-muted/60">
								<Smartphone className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
							</button>
						</TooltipTrigger>
						<TooltipContent side="top">{m.phone()}</TooltipContent>
					</Tooltip>}
					{availableUpdate && (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									aria-label={m.updateVersion()}
									onClick={updateApp}
									className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[var(--tyto-r-sm)] bg-primary text-primary-foreground transition-opacity duration-150 hover:opacity-90">
									<Download className="h-3.5 w-3.5" />
								</button>
							</TooltipTrigger>
							<TooltipContent side="top">{m.updateVersion()}</TooltipContent>
						</Tooltip>
					)}
					{version && <span className="tyto-sidebar-version">{version}</span>}
				</div>
			</div>

			{/* Drag edge: grab anywhere along the border to resize, double-click to reset. */}
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label={m.resizeSidebar()}
				{...handleProps}
				className={cn(
					'absolute inset-y-0 right-0 z-20 w-1.5 translate-x-1/2 cursor-col-resize touch-none',
					'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-primary/60 after:opacity-0 after:transition-opacity after:duration-150 hover:after:opacity-100',
					dragging && 'after:opacity-100',
				)}
			/>
		</aside>
	)
}
