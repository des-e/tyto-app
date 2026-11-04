import { Sparkles } from 'lucide-react'
import Markdown from 'react-markdown'
import { useMemo, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import ResummarizeDialog from '~/components/resummarize-dialog'
import { splitSummary } from '~/lib/ai'
import { openSettingsSection } from '~/lib/app'
import { useSession } from '../session'
import type { Job } from '../hooks/use-transcribe-queue'

/** What the AI step can do for this transcript right now; shared by the summary block and the topics column. */
export function useSummaryState(job: Job) {
	const { summaries } = useSession()
	const summarizing = Boolean(summaries.pending[job.id])
	const hasText = job.segments.length > 0
	return {
		summaries,
		summarizing,
		draft: summaries.drafts[job.id],
		progress: summaries.progress[job.id],
		error: summaries.errors[job.id],
		/** The AI is set up and the text is finished, so a summary can be made now. */
		canSummarize: summaries.enabled && hasText && job.status !== 'running',
		parts: useMemo(() => splitSummary(job.summary ?? ''), [job.summary]),
	}
}

/** «Саммари и темы делает ИИ-ассистент…» with the way to settings, for both places that need the AI. */
export function AiNeeded({ text }: { text: string }) {
	return (
		<div className="space-y-2.5">
			<p className="text-[13px] leading-[1.5] text-foreground">{text}</p>
			<p className="text-[12px] leading-[1.5] text-muted-foreground">{m.transcriptAiWays()}</p>
			<Button size="sm" onClick={() => openSettingsSection('ai')}>
				{m.transcriptAiConnect()}
			</Button>
		</div>
	)
}

/** Spinner and «Готовлю саммари · часть 2 из 5» while the model works. */
export function SummaryWorking({ progress }: { progress?: { done: number; total: number } }) {
	return (
		<p className="flex items-center gap-2 text-[13px] text-muted-foreground">
			<Spinner className="h-3.5 w-3.5" />
			{m.summarizeLoading()}
			{progress && progress.done < progress.total && (
				<span> · {m.summaryPart({ done: String(progress.done + 1), total: String(progress.total) })}</span>
			)}
		</p>
	)
}

/**
 * «Саммари» at the start of the text (design round 3): one or two paragraphs in a quiet card. Without
 * the AI the card says how to connect it; with the AI and no summary yet, one button makes it.
 */
export default function SummaryBlock({ job }: { job: Job }) {
	const { summaries, summarizing, draft, progress, error, canSummarize, parts } = useSummaryState(job)
	const [promptOpen, setPromptOpen] = useState(false)
	const streamed = useMemo(() => (draft ? splitSummary(draft).text : ''), [draft])

	let body: React.ReactNode
	if (summarizing && streamed) {
		body = (
			<div className="tyto-summary-text">
				<Markdown>{streamed}</Markdown>
				<span aria-hidden className="ms-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-foreground/60 align-text-bottom" />
			</div>
		)
	} else if (summarizing) {
		body = <SummaryWorking progress={progress} />
	} else if (error) {
		body = (
			<div className="space-y-2.5">
				<p className="text-[13px] text-destructive">{error}</p>
				<Button variant="outline" size="sm" onClick={() => void summaries.summarize(job)}>
					{m.retrySummary()}
				</Button>
			</div>
		)
	} else if (job.summary) {
		body = (
			<>
				{/* The models answer in markdown; render it rather than showing the syntax. */}
				<div className="tyto-summary-text">
					<Markdown>{parts.text}</Markdown>
				</div>
				{canSummarize && (
					<div className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-muted-foreground">
						<button type="button" onClick={() => void summaries.summarize(job)} className="cursor-pointer underline-offset-2 hover:text-foreground hover:underline">
							{m.regenerateSummary()}
						</button>
						{!summaries.tyto && (
							<button type="button" onClick={() => setPromptOpen(true)} className="cursor-pointer underline-offset-2 hover:text-foreground hover:underline">
								{m.customizeSummary()}
							</button>
						)}
					</div>
				)}
			</>
		)
	} else if (!summaries.enabled) {
		body = <AiNeeded text={m.transcriptAiNeeded()} />
	} else if (canSummarize) {
		body = (
			<Button size="sm" variant="outline" onClick={() => void summaries.summarize(job)}>
				<Sparkles className="h-3.5 w-3.5" />
				{m.transcriptMakeSummary()}
			</Button>
		)
	} else {
		return null
	}

	return (
		<section aria-label={m.summaryTab()} className="tyto-doc-indent tyto-summary-card mb-5 max-w-[560px]">
			{body}
			{promptOpen && (
				<ResummarizeDialog
				open={promptOpen}
				onOpenChange={setPromptOpen}
				loading={summarizing}
				onSubmit={(prompt) => {
					setPromptOpen(false)
					void summaries.summarize(job, prompt)
				}}
				/>
			)}
		</section>
	)
}
