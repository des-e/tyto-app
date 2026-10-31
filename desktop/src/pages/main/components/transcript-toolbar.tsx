import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Download, NotebookPen, Pencil, PilcrowLeft, PilcrowRight, Plus, Search, Settings2, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { usePreferenceProvider } from '~/providers/preference'
import { Button } from '~/components/ui/button'
import ResummarizeDialog from '~/components/resummarize-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/style'
import { SegmentedControl } from '~/lib/tyto/segmented-control'
import { TranscriptTabs } from '~/lib/tyto/transcript-tabs'
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
 * Everything the AI step can do for the open transcript, behind one icon — same popover grammar as
 * the view options, so the toolbar keeps its shape whether or not a summary exists.
 */
function SummaryMenu({ job, tab, setTab }: { job: Job | null; tab: TranscriptTab; setTab: (tab: TranscriptTab) => void }) {
	const { summaries } = useSession()
	const [open, setOpen] = useState(false)
	const [promptOpen, setPromptOpen] = useState(false)

	const summarizing = job ? Boolean(summaries.pending[job.id]) : false
	const summaryError = job ? summaries.errors[job.id] : undefined
	const hasSummary = Boolean(job?.summary)
	const hasText = (job?.segments.length ?? 0) > 0
	const canSummarize = summaries.enabled && hasText && job?.status !== 'running'
	const actionLabel =
		!canSummarize && hasSummary
			? m.summaryTab()
			: summarizing
				? m.summarizeLoading()
				: summaryError
					? m.retrySummary()
					: hasSummary
						? m.regenerateSummary()
						: m.summarizeTranscript()

	// Nothing to offer: the feature is off in settings and this transcript has no summary either.
	if (!canSummarize && !hasSummary) return null

	function run(prompt?: string) {
		setOpen(false)
		if (job) void summaries.summarize(job, prompt)
	}

	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<Button variant="ghost" size="sm" aria-label={actionLabel}>
								{summarizing ? <Spinner className="h-3.5 w-3.5" /> : <NotebookPen className="h-3.5 w-3.5" />}
								<span className="@max-[720px]:sr-only">{actionLabel}</span>
							</Button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent>{actionLabel}</TooltipContent>
				</Tooltip>
				<PopoverContent align="end" className="w-64 rounded-[var(--tyto-r-lg)] p-4">
					<p className="tyto-eyebrow mb-2">{m.aiSection()}</p>

					<div className="space-y-3">
						{hasSummary && (
							<SegmentedControl
								ariaLabel={m.aiSection()}
								value={tab}
								options={[
									{ value: 'transcript', label: m.segmentsTab() },
									{ value: 'summary', label: m.summaryTab() },
								]}
								onChange={setTab}
								className="flex w-full [&>button]:flex-1"
							/>
						)}

						<div className={cn('space-y-0.5', hasSummary && 'border-t border-border pt-2')}>
							{canSummarize && (
								<button
									type="button"
									disabled={summarizing}
									onClick={() => run()}
									className="flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--tyto-r-sm)] px-2 py-2 text-start text-sm text-foreground transition-colors duration-150 hover:bg-muted/70 disabled:pointer-events-none disabled:opacity-50">
									<Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
									{summaryError ? m.retrySummary() : hasSummary ? m.regenerateSummary() : m.summarizeTranscript()}
								</button>
							)}
							{canSummarize && (
								<button
									type="button"
									disabled={summarizing}
									onClick={() => {
										setOpen(false)
										setPromptOpen(true)
									}}
									className="flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--tyto-r-sm)] px-2 py-2 text-start text-sm text-foreground transition-colors duration-150 hover:bg-muted/70 disabled:pointer-events-none disabled:opacity-50">
									<Pencil className="h-3.5 w-3.5 text-muted-foreground" />
									{m.customizeSummary()}
								</button>
							)}
							{summaryError && <p className="px-2 pt-1 text-xs text-destructive">{m.summaryFailed()}</p>}
						</div>
					</div>
				</PopoverContent>
			</Popover>

			<ResummarizeDialog open={promptOpen} onOpenChange={setPromptOpen} loading={summarizing} onSubmit={(prompt) => run(prompt)} />
		</>
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
	const { queue, startNew } = useSession()
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
	const exporter = useTranscriptExport({
		enabled: exportOpen,
		direction: exportDirection,
		segments: job?.segments ?? [],
		summary: job?.summary,
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
		if (!job?.summary && exportOptions.content !== 'transcript') fix.content = 'transcript'
		if (exportOptions.format === 'csv') fix.format = 'normal'
		if (Object.keys(fix).length > 0) updateExport(fix)
		setExportOpen(true)
	}

	function closeSearch() {
		setSearching(false)
		setQuery('')
	}

	async function saveExport() {
		if (await exporter.save()) setExportOpen(false)
	}

	const hasText = (job?.segments.length ?? 0) > 0
	const hasExportContent = hasText || Boolean(job?.summary)

	return (
		<>
			<div className="@container sticky top-0 z-10 flex h-14 shrink-0 items-center gap-1 border-b border-border bg-background/85 px-4 backdrop-blur-md">
				<TranscriptTabs tab={tab} setTab={setTab} summaryReady={Boolean(job?.summary)} />
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
							{queue.jobs.length > 1 ? (
								/* A batch: the same word, with everything that writes files behind it. */
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="secondary" size="sm">
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
								<Button variant="secondary" size="sm" onClick={openExport} disabled={!hasExportContent}>
									<Download className="h-3.5 w-3.5" />
									{m.exportDialogTitle()}
								</Button>
							)}

							<Button variant="ghost" size="md" iconOnly aria-label={m.searchTranscript()} onClick={() => setSearching(true)} disabled={!hasText}>
								<Search className="h-3.5 w-3.5" />
							</Button>

							<SummaryMenu job={job} tab={tab} setTab={setTab} />

							<ViewOptions options={options} />

							<div className="flex items-center gap-1">
								{queue.running && (
									<Button
										variant="ghost"
										size="sm"
										onClick={queue.cancelAll}
										disabled={queue.isAborting}>
										{queue.isAborting ? m.aborting() : m.cancel()}
									</Button>
								)}
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="ghost" size="sm" aria-label={m.newSession()} onClick={startNew}>
											<Plus className="h-3.5 w-3.5" />
											<span className="@max-[720px]:sr-only">{m.newSession()}</span>
										</Button>
									</TooltipTrigger>
									<TooltipContent>{m.newSession()}</TooltipContent>
								</Tooltip>
							</div>
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
				hasSummary={Boolean(job?.summary)}
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
