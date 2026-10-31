import { Clipboard, Download, FileText } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import jsonLanguage from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { m } from '~/paraglide/messages.js'
import { formatExtensions, type TextFormat } from '~/components/format-select'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { projectExportFilename } from '~/lib/project-name'
import { cn } from '~/lib/style'
import { usePreferenceProvider } from '~/providers/preference'
import type { TranscriptExportContent } from '~/lib/transcript-export'
import {
	EXPORT_FORMATS,
	ExportCheckRows,
	ExportContentCards,
	ExportFormatGrid,
	ExportGroup,
	canCopy,
	hasDocumentTheme,
	timestampsRequired,
} from '~/lib/tyto/export-format-grid'
import { durationLabel } from '~/lib/tyto/format'

SyntaxHighlighter.registerLanguage('json', jsonLanguage)

export interface TranscriptExportDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	format: TextFormat
	onFormatChange: (format: TextFormat) => void
	content: TranscriptExportContent
	onContentChange: (content: TranscriptExportContent) => void
	hasSummary: boolean
	showTimestamps: boolean
	onShowTimestampsChange: (show: boolean) => void
	showSpeakers: boolean
	onShowSpeakersChange: (show: boolean) => void
	preview: string
	renderedPreview?: string
	direction: 'rtl' | 'ltr'
	/** Direction of this export only — a one-off override, never saved. */
	onDirectionChange: (direction: 'rtl' | 'ltr') => void
	/** Appearance of the exported file, kept apart from the app's own theme. */
	theme: 'dark' | 'light'
	onThemeChange: (theme: 'dark' | 'light') => void
	onCopy: () => void | Promise<void>
	onSave: () => void | Promise<void>
	/** Name of the recording: shown in the header and used for the suggested file name. */
	title?: string
	/** Length of the recording in seconds, shown next to its name. */
	durationSeconds?: number
}

/** Formats offered in the dialog (CSV is not one of them, see EXPORT_FORMAT_GROUPS). */
export const formats = EXPORT_FORMATS

function VirtualPreviewRows({
	rows,
	direction,
	className,
	renderRow,
}: {
	rows: string[]
	direction: 'rtl' | 'ltr'
	className?: string
	renderRow: (row: string, index: number) => ReactNode
}) {
	const scrollRef = useRef<HTMLDivElement>(null)
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 30,
		overscan: 10,
		measureElement: (element) => element.getBoundingClientRect().height,
	})

	return (
		<div
			ref={scrollRef}
			tabIndex={0}
			dir={direction}
			aria-label={m.exportPreviewAriaLabel()}
			// The sheet: thin frame, small radius, a light shadow on the grey preview surface.
			className={cn(
				'min-h-[14rem] flex-1 overflow-auto rounded-[var(--tyto-r-xs)] border border-border shadow-[0_2px_10px_rgb(0_0_0/0.06)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground focus-visible:outline-offset-2',
				className,
			)}>
			<div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
				{virtualizer.getVirtualItems().map((virtualRow) => (
					<div
						key={virtualRow.key}
						ref={virtualizer.measureElement}
						data-index={virtualRow.index}
						className="absolute start-0 top-0 w-full"
						style={{ transform: `translateY(${virtualRow.start}px)` }}>
						{renderRow(rows[virtualRow.index], virtualRow.index)}
					</div>
				))}
			</div>
		</div>
	)
}

function htmlPreviewRows(html: string) {
	const parsed = new DOMParser().parseFromString(html, 'text/html')
	const main = parsed.querySelector('main')
	if (!main) return []
	const rows: string[] = []
	for (const child of main.children) {
		if (child.matches('section.transcript, section.summary')) {
			for (const nested of child.children) rows.push(nested.outerHTML)
		} else {
			rows.push(child.outerHTML)
		}
	}
	return rows
}

/*
 * The document's own theme, independent of the app's: every colour on the sheet is explicit, so a light
 * document inside the dark app (or the reverse) never picks up app tokens like text-primary.
 */
const SHEET = {
	light: 'bg-white text-[#1a1c1f] [&_.metadata]:text-[#6b6b6b] [&_h2]:border-[#e5e5e5]',
	dark: 'bg-[#181818] text-[#ececec] [&_.metadata]:text-[#a1a1a1] [&_h2]:border-[#333333]',
}

function RenderedDocumentPreview({ html, direction, theme }: { html: string; direction: 'rtl' | 'ltr'; theme: 'dark' | 'light' }) {
	const rows = useMemo(() => htmlPreviewRows(html), [html])
	return (
		<VirtualPreviewRows
			rows={rows}
			direction={direction}
			className={cn(
				'px-8 py-4 font-sans text-[12.5px] leading-relaxed [&_.metadata]:mb-1 [&_.metadata]:text-[11px] [&_.metadata]:font-semibold [&_.segment]:py-2 [&_h1]:pt-4 [&_h1]:pb-1 [&_h1]:text-lg [&_h1]:leading-tight [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h2]:border-b [&_h2]:py-3 [&_h2]:text-[15px] [&_h2]:font-semibold [&_p]:whitespace-pre-wrap',
				SHEET[theme],
			)}
			renderRow={(row) => <div dangerouslySetInnerHTML={{ __html: row }} />}
		/>
	)
}

export default function TranscriptExportDialog({
	open,
	onOpenChange,
	format,
	onFormatChange,
	content,
	onContentChange,
	hasSummary,
	showTimestamps,
	onShowTimestampsChange,
	showSpeakers,
	onShowSpeakersChange,
	preview,
	renderedPreview,
	direction,
	onDirectionChange,
	theme,
	onThemeChange,
	onCopy,
	onSave,
	title = '',
	durationSeconds = 0,
}: TranscriptExportDialogProps) {
	const timesLocked = timestampsRequired(format)
	const selectedFormat = formats.find((option) => option.value === format)
	const fileName = projectExportFilename(title, formatExtensions[format].slice(1))
	const dot = fileName.lastIndexOf('.')
	const fileStem = fileName.slice(0, dot)
	const fileExtension = fileName.slice(dot)
	// JSON has no document theme (its toggle is hidden), so its code colours follow the app, like its surface.
	const appTheme = usePreferenceProvider().theme
	const subtitle = durationSeconds > 0 ? `${title} · ${durationLabel(durationSeconds)}` : title

	const appearance = [
		{ id: 'speakers', label: m.showSpeakers(), checked: showSpeakers, onChange: onShowSpeakersChange },
		{
			id: 'timestamps',
			label: m.showTimestamps(),
			note: timesLocked ? m.exportTimestampsRequired() : undefined,
			checked: timesLocked || showTimestamps,
			disabled: timesLocked,
			onChange: onShowTimestampsChange,
		},
		...(hasDocumentTheme(format)
			? [{ id: 'theme', label: m.exportDarkTheme(), checked: theme === 'dark', onChange: (dark: boolean) => onThemeChange(dark ? 'dark' : 'light') }]
			: []),
		{ id: 'rtl', label: m.exportRtl(), checked: direction === 'rtl', onChange: (rtl: boolean) => onDirectionChange(rtl ? 'rtl' : 'ltr') },
	]

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex h-[min(700px,90vh)] w-[calc(100%_-_1.5rem)] max-w-[980px] flex-col gap-0 overflow-hidden rounded-[var(--tyto-r-lg)] border-border bg-background p-0 shadow-2xl sm:rounded-[var(--tyto-r-lg)]">
				<DialogHeader className="shrink-0 space-y-0.5 border-b border-border py-4 ps-6 pe-14 text-start">
					<DialogTitle className="tyto-title-dialog">{m.exportDialogTitle()}</DialogTitle>
					<DialogDescription className="truncate text-[13px] text-muted-foreground" title={subtitle}>
						{subtitle}
					</DialogDescription>
				</DialogHeader>

				<div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[420px_minmax(0,1fr)] md:overflow-hidden">
					<div className="space-y-6 p-6 md:overflow-y-auto md:border-e md:border-border">
						<ExportGroup id="tyto-export-content" label={m.exportContent()}>
							<ExportContentCards value={content} onChange={onContentChange} hasSummary={hasSummary} />
						</ExportGroup>

						<ExportGroup id="tyto-export-format" label={m.format()}>
							<ExportFormatGrid value={format} onChange={onFormatChange} />
							<p className="mt-2 min-h-[1.25rem] text-[12.5px] text-muted-foreground">{selectedFormat?.description()}</p>
						</ExportGroup>

						<ExportGroup id="tyto-export-appearance" label={m.exportAppearance()}>
							<ExportCheckRows rows={appearance} />
						</ExportGroup>
					</div>

					<section
						className="flex min-h-[18rem] flex-col border-t border-border bg-muted p-6 md:min-h-0 md:border-t-0"
						aria-labelledby="tyto-export-preview">
						<h3 id="tyto-export-preview" className="tyto-eyebrow mb-2">
							{m.exportPreview()}
						</h3>
						{renderedPreview ? (
							<RenderedDocumentPreview html={renderedPreview} direction={direction} theme={theme} />
						) : format === 'md' ? (
							<VirtualPreviewRows
								rows={preview.split(/\n{2,}/)}
								direction={direction}
								className="bg-background px-8 py-4 text-foreground"
								renderRow={(block) => (
									<div className="prose max-w-none py-2 text-[12.5px] dark:prose-invert">
										<Markdown>{block}</Markdown>
									</div>
								)}
							/>
						) : format === 'json' ? (
							<VirtualPreviewRows
								rows={preview.split('\n')}
								direction="ltr"
								className="bg-[#fafafa] py-4 text-left dark:bg-[#282c34]"
								renderRow={(line) => (
									<SyntaxHighlighter
										language="json"
										style={appTheme === 'dark' ? oneDark : oneLight}
										customStyle={{
											margin: 0,
											padding: '0 1rem',
											fontSize: '12px',
											lineHeight: 1.7,
											textAlign: 'left',
											// Each row is its own <pre>: left to itself it scrolls, so a long line grows a scrollbar inside
											// every row instead of one on the preview. Wrapping keeps the scrolling on the preview alone.
											overflow: 'visible',
											whiteSpace: 'pre-wrap',
											wordBreak: 'break-word',
											background: 'transparent',
										}}
										codeTagProps={{ style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }}>
										{line || ' '}
									</SyntaxHighlighter>
								)}
							/>
						) : (
							<VirtualPreviewRows
								rows={preview.split('\n')}
								direction={direction}
								className="bg-background px-8 py-4 font-mono text-xs leading-relaxed text-foreground"
								renderRow={(line) => <div className="min-h-[1.7em] whitespace-pre-wrap break-words">{line || ' '}</div>}
							/>
						)}
					</section>
				</div>

				<div className="flex shrink-0 items-center gap-2 border-t border-border px-6 py-3">
					<span className="me-auto flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
						<FileText aria-hidden="true" className="size-4 shrink-0" />
						{/* Only the stem shortens: the extension stays visible, the full name is the tooltip. */}
						<span className="flex min-w-0" title={fileName} data-testid="tyto-export-filename">
							<span className="truncate">{fileStem}</span>
							<span className="shrink-0">{fileExtension}</span>
						</span>
					</span>
					<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
						{m.exportCancel()}
					</Button>
					{canCopy(format) && (
						<Button type="button" variant="secondary" onClick={() => void onCopy()}>
							<Clipboard aria-hidden="true" />
							{m.exportCopy()}
						</Button>
					)}
					<Button type="button" variant="primary" onClick={() => void onSave()}>
						<Download aria-hidden="true" />
						{m.exportSave({ format: selectedFormat?.extension ?? format.toUpperCase() })}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
