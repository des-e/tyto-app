import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { m } from '~/paraglide/messages.js'
import type { TextFormat } from '~/components/format-select'
import { cn } from '~/lib/style'
import type { TranscriptExportContent } from '~/lib/transcript-export'

/*
 * Left column of the export dialog (docs/design/2026-10-25-tyto-visual-language.md, «Диалог экспорта», v2):
 * «Что сохранить» cards, the 4 + 4 format grid and the four «Оформление» checkboxes.
 *
 * Every choice is a native <input> inside its <label>, never `role="radio"` on a button: theme.css paints
 * `[role=radiogroup] [role=radio][aria-checked=true]` as a solid ink plate, and these controls must stay
 * outlined (that clash is what made the cards unreadable in the v2 mockup).
 */

export interface ExportFormatOption {
	value: TextFormat
	extension: string
	label: () => string
	description: () => string
}

/** Formats as the dialog shows them, in two groups of four. CSV is left out on purpose (the exporter still supports it). */
export const EXPORT_FORMAT_GROUPS: Array<{ id: 'document' | 'web'; label: () => string; formats: ExportFormatOption[] }> = [
	{
		id: 'document',
		label: m.exportFormatGroupDocument,
		formats: [
			{ value: 'pdf', extension: 'PDF', label: m.exportFormatPdf, description: m.exportFormatPdfDescription },
			{ value: 'docx', extension: 'DOCX', label: m.exportFormatDocx, description: m.exportFormatDocxDescription },
			{ value: 'normal', extension: 'TXT', label: m.exportFormatText, description: m.exportFormatTextDescription },
			{ value: 'md', extension: 'MD', label: m.exportFormatMarkdown, description: m.exportFormatMarkdownDescription },
		],
	},
	{
		id: 'web',
		label: m.exportFormatGroupWeb,
		formats: [
			{ value: 'html', extension: 'HTML', label: m.exportFormatHtml, description: m.exportFormatHtmlDescription },
			{ value: 'srt', extension: 'SRT', label: m.exportFormatSrt, description: m.exportFormatSrtDescription },
			{ value: 'vtt', extension: 'VTT', label: m.exportFormatVtt, description: m.exportFormatVttDescription },
			{ value: 'json', extension: 'JSON', label: m.exportFormatJson, description: m.exportFormatJsonDescription },
		],
	},
]

export const EXPORT_FORMATS: ExportFormatOption[] = EXPORT_FORMAT_GROUPS.flatMap((group) => group.formats)

/** Subtitles cannot exist without times, so SRT and VTT always export them. */
export function timestampsRequired(format: TextFormat) {
	return format === 'srt' || format === 'vtt'
}

/** Formats with a styled document, the only ones where a dark document theme means anything. */
export function hasDocumentTheme(format: TextFormat) {
	return format === 'pdf' || format === 'html' || format === 'docx'
}

/** Formats whose output is plain text, so it can go to the clipboard. */
export function canCopy(format: TextFormat) {
	return !hasDocumentTheme(format)
}

const focusRing = 'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-foreground has-[:focus-visible]:outline-offset-2'

/** 16px radio dot: thin ring, a thick ink ring when chosen. */
function RadioDot({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				'block size-4 shrink-0 rounded-full border',
				checked ? 'border-[5px] border-foreground' : 'border-[var(--tyto-line2)]',
				disabled && 'border-border',
			)}
		/>
	)
}

export function ExportGroup({ label, children, id }: { label: string; children: ReactNode; id: string }) {
	return (
		<section aria-labelledby={id}>
			<h3 id={id} className="tyto-eyebrow mb-2">
				{label}
			</h3>
			{children}
		</section>
	)
}

export function ExportContentCards({
	value,
	onChange,
	hasSummary,
}: {
	/** 'both' (an older stored choice) leaves neither card selected, as before. */
	value: TranscriptExportContent
	onChange: (value: TranscriptExportContent) => void
	hasSummary: boolean
}) {
	const cards = [
		{ value: 'transcript' as const, name: m.exportContentTranscript(), description: m.exportContentTranscriptDescription(), disabled: false },
		{
			value: 'summary' as const,
			name: m.exportContentSummary(),
			description: hasSummary ? m.exportContentSummaryDescription() : m.exportSummaryUnavailable(),
			disabled: !hasSummary,
		},
	]
	return (
		<div className="grid grid-cols-2 gap-2">
			{cards.map((card) => {
				const checked = value === card.value
				return (
					<label
						key={card.value}
						className={cn(
							'flex gap-2 rounded-[var(--tyto-r-md)] border bg-transparent p-3 text-foreground',
							focusRing,
							card.disabled
								? 'cursor-not-allowed border-border text-[var(--tyto-disabled-fg)]'
								: checked
									? 'cursor-pointer border-foreground shadow-[inset_0_0_0_1px_var(--foreground)]'
									: 'cursor-pointer border-[var(--tyto-line2)] hover:border-[var(--muted-foreground)]',
						)}>
						<input
							type="radio"
							name="tyto-export-content"
							className="sr-only"
							value={card.value}
							checked={checked}
							disabled={card.disabled}
							onChange={() => onChange(card.value)}
						/>
						<span className="block shrink-0 pt-px">
							<RadioDot checked={checked} disabled={card.disabled} />
						</span>
						<span className="min-w-0">
							<span className="block text-[13.5px] leading-[1.3] font-medium">{card.name}</span>
							<span
								className={cn(
									'mt-0.5 block text-xs leading-[1.35]',
									card.disabled ? 'text-[var(--tyto-disabled-fg)]' : 'text-muted-foreground',
								)}>
								{card.description}
							</span>
						</span>
					</label>
				)
			})}
		</div>
	)
}

/**
 * Both columns live in one grid (a 24px heading row + four 32px rows, 24px between columns); each group is
 * a subgrid spanning those rows, so the rows line up across columns while each group stays one named
 * group in reading order. Highlighted rows bleed 8px past the group edge so the radios sit on its left edge.
 */
export function ExportFormatGrid({ value, onChange }: { value: TextFormat; onChange: (value: TextFormat) => void }) {
	return (
		<div className="grid grid-cols-2 grid-rows-[24px_repeat(4,32px)] gap-x-6">
			{EXPORT_FORMAT_GROUPS.map((group) => {
				const headingId = `tyto-export-group-${group.id}`
				return (
					<div key={group.id} role="group" aria-labelledby={headingId} className="row-span-5 grid min-w-0 grid-rows-subgrid">
						<span id={headingId} className="self-start text-xs leading-4 text-muted-foreground">
							{group.label()}
						</span>
						{group.formats.map((option) => {
							const checked = value === option.value
							return (
								<label
									key={option.value}
									className={cn(
										'-mx-2 flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-[var(--tyto-r-sm)] px-2 text-[13.5px] leading-5 text-foreground',
										focusRing,
										checked ? 'bg-muted font-medium' : 'hover:bg-muted/60',
									)}>
									<input
										type="radio"
										name="tyto-export-format"
										className="sr-only"
										value={option.value}
										checked={checked}
										onChange={() => onChange(option.value)}
									/>
									<RadioDot checked={checked} />
									<span className="truncate">{option.label()}</span>
									<span className="ms-auto text-[11px] leading-none font-medium tracking-[0.02em] text-muted-foreground">{option.extension}</span>
								</label>
							)
						})}
					</div>
				)
			})}
		</div>
	)
}

export interface ExportCheckOption {
	id: string
	label: string
	/** Muted note after the label, e.g. why the box is locked. */
	note?: string
	checked: boolean
	disabled?: boolean
	onChange: (checked: boolean) => void
}

/** «Оформление»: identical 32px rows, a 16px box, 8px gap, label. Nothing on the right. */
export function ExportCheckRows({ rows }: { rows: ExportCheckOption[] }) {
	return (
		<div className="grid auto-rows-[32px]">
			{rows.map((row) => (
				<label
					key={row.id}
					className={cn(
						'grid grid-cols-[16px_1fr] items-center gap-x-2 text-[13.5px] leading-5 text-foreground',
						row.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
						focusRing,
					)}>
					<input
						type="checkbox"
						className="sr-only"
						checked={row.checked}
						disabled={row.disabled}
						onChange={(event) => row.onChange(event.target.checked)}
					/>
					<span
						aria-hidden="true"
						className={cn(
							'flex size-4 items-center justify-center rounded-[var(--tyto-r-xs)] border',
							row.checked
								? row.disabled
									? 'border-[var(--tyto-disabled-fg)] bg-[var(--tyto-disabled-fg)] text-background'
									: 'border-foreground bg-foreground text-background'
								: 'border-[var(--tyto-line2)]',
						)}>
						{/* Inline: theme.css thins every lucide icon to 1.5, too faint at 12px. */}
						{row.checked && <Check className="size-3" style={{ strokeWidth: 2 }} />}
					</span>
					<span className="min-w-0 truncate">
						{row.label}
						{row.note && <span className="ms-2 text-muted-foreground">{row.note}</span>}
					</span>
				</label>
			))}
		</div>
	)
}
