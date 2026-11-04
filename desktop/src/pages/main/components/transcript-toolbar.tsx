import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Download, PilcrowLeft, PilcrowRight, Search, Settings2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { aiExportText, plainAiText } from '~/lib/tyto/ai-export'
import { m } from '~/paraglide/messages.js'
import { usePreferenceProvider } from '~/providers/preference'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { SegmentedControl } from '~/lib/tyto/segmented-control'
import type { TextFormat } from '~/components/format-select'
import type { Job } from '../hooks/use-transcribe-queue'
import type { TranscriptTab, TranscriptTextSize, TranscriptViewOptions } from '../hooks/use-transcript-view'
import { useTranscriptExport } from '../hooks/use-transcript-export'
import TranscriptExportDialog from './transcript-export-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { useSession } from '../session'

const TEXT_SIZES: { value: TranscriptTextSize; label: () => string }[] = [
	{ value: 'sm', label: () => m.textSizeSmall() },
	{ value: 'md', label: () => m.textSizeMedium() },
	{ value: 'lg', label: () => m.textSizeLarge() },
]

/** Reading controls for the transcript: type scale, timestamps, speaker labels. */
function ViewOptions({ options }: { options: TranscriptViewOptions }) {
	// Direction belongs to the reading view too, even though it is stored with the other preferences.
	const preference = usePreferenceProvider()

	return (
		<Popover>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button variant="ghost" size="md" iconOnly aria-label={m.viewOptions()}>
							<Settings2 className="h-3.5 w-3.5" />
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>{m.viewOptions()}</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" className="w-64 rounded-[var(--tyto-r-lg)] p-4">
				<p className="tyto-eyebrow mb-2">{m.viewOptions()}</p>
				<div className="space-y-3">
					<div className="space-y-1.5">
						<span className="text-sm text-foreground">{m.textSize()}</span>
						<SegmentedControl
							ariaLabel={m.textSize()}
							value={options.textSize}
							options={TEXT_SIZES.map((size) => ({ value: size.value, label: size.label() }))}
							onChange={options.setTextSize}
							className="flex w-full [&>button]:flex-1"
						/>
					</div>
					<div className="flex items-center justify-between gap-4 border-t border-border pt-3">
						<span className="text-sm text-foreground">{m.textDirection()}</span>
						<SegmentedControl
							ariaLabel={m.textDirection()}
							value={preference.textAreaDirection}
							options={[
								{ value: 'ltr', label: 'LTR', icon: <PilcrowRight className="h-3.5 w-3.5" /> },
								{ value: 'rtl', label: 'RTL', icon: <PilcrowLeft className="h-3.5 w-3.5" /> },
							]}
							onChange={preference.setTextAreaDirection}
						/>
					</div>

					<div className="flex items-center justify-between gap-4">
						<span className="text-sm text-foreground">{m.showTimestamps()}</span>
						<Switch checked={options.showTimestamps} onCheckedChange={options.setShowTimestamps} />
					</div>
					<div className="flex items-center justify-between gap-4">
						<span className="text-sm text-foreground">{m.showSpeakers()}</span>
						<Switch checked={options.showSpeakers} onCheckedChange={options.setShowSpeakers} />
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}

/**
 * «Саммари · Темы · ИИ-разбор» at the start of the toolbar (design round 3). The first two show and
 * hide their blocks around the text, and the first press on a transcript without a summary makes one
 * (the same request brings the topics). «ИИ-разбор» puts the review in place of the text.
 */
function AiToggles({
	job,
	options,
	tab,
	setTab,
}: {
	job: Job | null
	options: TranscriptViewOptions
	tab: TranscriptTab
	setTab: (tab: TranscriptTab) => void
}) {
	const { summaries } = useSession()
	const summarizing = job ? Boolean(summaries.pending[job.id]) : false
	const reviewing = job ? Boolean(summaries.reviewing[job.id]) : false
	const canSummarize = Boolean(job) && summaries.enabled && (job?.segments.length ?? 0) > 0 && job?.status !== 'running'

	function show(set: (value: boolean) => void, on: boolean) {
		const next = !on
		set(next)
		if (tab === 'review') setTab('transcript')
		if (next && job && !job.summary && canSummarize && !summarizing) void summaries.summarize(job)
	}

	// Until the text is finished there is nothing to summarise or review (design round 4).
	const waiting = !job || job.status === 'running' || job.status === 'queued'
	const summaryOn = options.showSummary && tab === 'transcript' && !waiting
	const topicsOn = options.showTopics && tab === 'transcript' && !waiting

	return (
		<div className="flex items-center gap-1">
			<button type="button" aria-pressed={summaryOn} disabled={waiting} onClick={() => show(options.setShowSummary, summaryOn)} className="tyto-toggle">
				{summarizing && <Spinner className="h-3 w-3" />}
				{m.summaryTab()}
			</button>
			<button type="button" aria-pressed={topicsOn} disabled={waiting} onClick={() => show(options.setShowTopics, topicsOn)} className="tyto-toggle">
				{m.topicsTab()}
			</button>
			<button
				type="button"
				aria-pressed={tab === 'review' && !waiting}
				disabled={waiting}
				onClick={() => setTab(tab === 'review' ? 'transcript' : 'review')}
				className="tyto-toggle">
				{reviewing && <Spinner className="h-3 w-3" />}
				{m.tytoAiReview()}
			</button>
		</div>
	)
}

export default function TranscriptToolbar({
	job,
	query,
	setQuery,
	options,
	tab,
	setTab,
}: {
	job: Job | null
	query: string
	setQuery: (value: string) => void
	options: TranscriptViewOptions
	tab: TranscriptTab
	setTab: (tab: TranscriptTab) => void
}) {
	const { queue, summaries } = useSession()
	const preference = usePreferenceProvider()
	const [exportOpen, setExportOpen] = useState(false)
	const autoExport = preference.autoExport
	const exportOptions = preference.exportOptions
	// Each control changes one field of the stored object.
	const updateExport = (patch: Partial<typeof exportOptions>) => preference.setExportOptions({ ...exportOptions, ...patch })
	// A one-off override: the dialog opens on the transcript's own direction every time.
	const [exportDirection, setExportDirection] = useState(preference.textAreaDirection)
	const [searching, setSearching] = useState(false)
	const searchRef = useRef<HTMLInputElement>(null)
	const aiMarkdown = useMemo(() => (job ? aiExportText({ summary: job.summary, thread: job.thread }) : ''), [job?.summary, job?.thread])
	// Markdown keeps its marks; every other format gets the text without «##» and «**».
	const aiText = exportOptions.format === 'md' ? aiMarkdown : plainAiText(aiMarkdown)
	const exporter = useTranscriptExport({
		enabled: exportOpen,
		direction: exportDirection,
		segments: job?.segments ?? [],
		// The second card is «ИИ-разбор» now: summary, topics and review in one text.
		summary: aiText || undefined,
		file: job ? { name: job.name, path: job.path } : null,
		format: exportOptions.format,
		content: exportOptions.content,
		showTimestamps: exportOptions.showTimestamps,
		showSpeakers: exportOptions.showSpeakers,
		speakerNames: job?.speakerNames,
	})

	useEffect(() => {
		if (exportOpen) setExportDirection(preference.textAreaDirection)
	}, [exportOpen, preference.textAreaDirection])

	useEffect(() => {
		if (!searching) return
		// The row animates in, so claim focus again once that frame has painted.
		const frame = requestAnimationFrame(() => searchRef.current?.focus())
		searchRef.current?.focus()
		return () => cancelAnimationFrame(frame)
	}, [searching])

	function openExport() {
		// The dialog reopens on the choices it was left with; only a saved choice that this
		// transcript cannot honour — a summary it does not have — is corrected.
		// CSV is no longer offered in the dialog (Tyto), so a stored CSV choice falls back to plain text.
		const fix: Partial<typeof exportOptions> = {}
		if (!aiText && !canMakeReview && exportOptions.content !== 'transcript') fix.content = 'transcript'
		if (exportOptions.format === 'csv') fix.format = 'normal'
		if (Object.keys(fix).length > 0) updateExport(fix)
		setExportOpen(true)
	}

	function closeSearch() {
		setSearching(false)
		setQuery('')
	}

	// «ИИ-разбор» chosen before the review exists: saving makes it with Tyto AI first, then saves the
	// file once the review has landed in the project (Denis, 2026-11-04). Without Tyto AI the card
	// holds what the AI already wrote.
	const hasReview = (job?.thread ?? []).some((entry) => entry.question === m.tytoAiReview())
	const canMakeReview = Boolean(job) && summaries.tyto && summaries.enabled && (job?.segments.length ?? 0) > 0 && job?.status !== 'running'
	const reviewOnSave = exportOptions.content === 'summary' && !hasReview && canMakeReview
	const reviewing = job ? Boolean(summaries.reviewing[job.id]) : false
	const [saveAfterReview, setSaveAfterReview] = useState(false)

	async function saveExport() {
		if (reviewOnSave && job) {
			setSaveAfterReview(true)
			if (!(await summaries.review(job))) setSaveAfterReview(false)
			return
		}
		if (await exporter.save()) setExportOpen(false)
	}

	// The review is in the job now, so this render's exporter already writes it.
	useEffect(() => {
		if (!saveAfterReview || !hasReview) return
		setSaveAfterReview(false)
		void exporter.save().then((saved) => saved && setExportOpen(false))
	}, [saveAfterReview, hasReview, exporter])

	const hasText = (job?.segments.length ?? 0) > 0
	// A transcript still being written exports only once it is finished.
	const hasExportContent = (hasText || Boolean(aiText)) && job?.status !== 'running'

	return (
		<>
			<div className="@container sticky top-0 z-10 flex h-12 shrink-0 items-center gap-1 bg-background ps-8 pe-4">
				<AiToggles job={job} options={options} tab={tab} setTab={setTab} />
				<AnimatePresence initial={false} mode="wait">
					{searching ? (
						<motion.div
							key="search"
							initial={{ opacity: 0, y: -4 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -4 }}
							transition={{ duration: 0.15, ease: 'easeOut' }}
							className="flex min-w-0 flex-1 items-center gap-2 ps-4">
							<Search className="h-4 w-4 shrink-0 text-muted-foreground" />
							<input
								ref={searchRef}
								autoFocus
								autoComplete="off"
								autoCorrect="off"
								autoCapitalize="none"
								spellCheck={false}
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={(event) => event.key === 'Escape' && closeSearch()}
								placeholder={m.searchTranscript()}
								className="h-9 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
							/>
							<Button variant="ghost" size="sm" iconOnly aria-label={m.closeSearch()} onClick={closeSearch}>
								<X className="h-4 w-4" />
							</Button>
						</motion.div>
					) : (
						<motion.div
							key="actions"
							initial={{ opacity: 0, y: -4 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -4 }}
							transition={{ duration: 0.15, ease: 'easeOut' }}
							className="flex min-w-0 flex-1 items-center justify-end gap-1">
							<Button variant="ghost" size="md" iconOnly aria-label={m.searchTranscript()} onClick={() => setSearching(true)} disabled={!hasText}>
								<Search className="h-4 w-4" />
							</Button>

							<ViewOptions options={options} />

							{queue.jobs.length > 1 ? (
								/* A batch: the same word, with everything that writes files behind it. */
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="secondary" size="sm" className="ms-1.5">
											<Download className="h-3.5 w-3.5" />
											{m.exportDialogTitle()}
											<ChevronDown className="h-3 w-3 opacity-70" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" className="w-60">
										<DropdownMenuItem onClick={openExport} disabled={!hasExportContent}>
											{m.exportThisTranscript()}
										</DropdownMenuItem>
										<DropdownMenuItem onClick={() => void queue.exportFinished()} disabled={queue.unexportedCount === 0}>
											{m.exportAllFinished({ count: String(queue.unexportedCount) })}
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											onClick={() => window.dispatchEvent(new CustomEvent('vibe:open-settings', { detail: { scrollTo: 'auto-export' } }))}
											className="flex items-center justify-between gap-3">
											<span className="shrink-0 whitespace-nowrap">{m.autoExport()}</span>
											<span className="truncate text-[11px] text-muted-foreground">
												{autoExport.enabled
													? `${m.autoExportOn()} · ${autoExport.formats.map((format) => (format === 'normal' ? 'TXT' : format.toUpperCase())).join(', ')}`
													: m.autoExportOff()}
											</span>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							) : (
								<Button variant="secondary" size="sm" className="ms-1.5" onClick={openExport} disabled={!hasExportContent}>
									<Download className="h-3.5 w-3.5" />
									{m.exportDialogTitle()}
								</Button>
							)}

						</motion.div>
					)}
				</AnimatePresence>
			</div>
			<TranscriptExportDialog
				open={exportOpen}
				onOpenChange={setExportOpen}
				format={exportOptions.format}
				onFormatChange={(format: TextFormat) => updateExport({ format })}
				content={exportOptions.content}
				onContentChange={(content) => updateExport({ content })}
				hasSummary={Boolean(aiText) || canMakeReview}
				reviewOnSave={reviewOnSave}
				reviewing={reviewing}
				showTimestamps={exportOptions.showTimestamps}
				onShowTimestampsChange={(showTimestamps) => updateExport({ showTimestamps })}
				showSpeakers={exportOptions.showSpeakers}
				onShowSpeakersChange={(showSpeakers) => updateExport({ showSpeakers })}
				preview={exporter.preview}
				renderedPreview={exporter.renderedPreview}
				direction={exportDirection}
				onDirectionChange={setExportDirection}
				theme={exportOptions.theme}
				onThemeChange={(theme) => updateExport({ theme })}
				onCopy={exporter.copy}
				onSave={saveExport}
				title={job?.name}
				durationSeconds={(job?.segments[job.segments.length - 1]?.stop ?? 0) / 100}
			/>
		</>
	)
}
