import { ArrowUp, Sparkles, X } from 'lucide-react'
import Markdown from 'react-markdown'
import { useEffect, useRef, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/style'
import { usePreferenceProvider } from '~/providers/preference'
import { useSession } from '../session'
import type { Job } from '../hooks/use-transcribe-queue'
import { textSizeClass, type TranscriptViewOptions } from '../hooks/use-transcript-view'
import { AiNeeded } from './summary-view'

/** Markdown with a blinking caret at the end while text is still arriving. */
function Streaming({ text, size }: { text: string; size: TranscriptViewOptions['textSize'] }) {
	return (
		<div className={cn('prose prose-neutral max-w-none dark:prose-invert', textSizeClass[size])}>
			<Markdown>{text}</Markdown>
			<span aria-hidden className="ms-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-foreground/60 align-text-bottom" />
		</div>
	)
}

/**
 * «ИИ-разбор» in place of the text. With Tyto AI it is the review (who, what, by when, a timeline),
 * made by one button; with an own key or Ollama it is questions about the recording. Everything the
 * model writes lands in the project file, so a review made today is still there next month.
 */
export default function ReviewView({ job, options }: { job: Job; options: TranscriptViewOptions }) {
	const preference = usePreferenceProvider()
	const { summaries } = useSession()
	const [question, setQuestion] = useState('')
	// The question just sent, shown above its answer while the answer streams.
	const [sent, setSent] = useState<string | null>(null)
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const scrollRef = useRef<HTMLDivElement>(null)

	const asking = Boolean(summaries.asking[job.id])
	const answerDraft = summaries.answerDrafts[job.id]
	const thread = job.thread ?? []
	const reviewing = Boolean(summaries.reviewing[job.id])
	const hasText = job.segments.length > 0 && job.status !== 'running'
	// Tyto AI has no free-form questions; it offers the AI review instead.
	const canAsk = summaries.enabled && hasText && !summaries.tyto
	const canReview = summaries.enabled && summaries.tyto && hasText

	// Follow the answer as it grows, the way a chat does.
	useEffect(() => {
		if (asking || thread.length > 0) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
	}, [asking, answerDraft, thread.length])

	function send() {
		const text = question.trim()
		if (!text || asking) return
		setQuestion('')
		setSent(text)
		void summaries.ask(job, text).finally(() => setSent(null))
		inputRef.current?.focus()
	}

	return (
		<div className="relative flex h-full min-h-0 flex-col">
			<div ref={scrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
				<div dir={preference.textAreaDirection} className={cn('mx-auto w-full max-w-[86ch] px-8 py-10 xl:max-w-[96ch]', canAsk && 'pb-28')}>
					<h2 className="mb-1 text-[24px] font-semibold tracking-[-0.02em] text-foreground">{m.tytoAiReview()}</h2>
					<p className="mb-8 truncate text-[13px] text-muted-foreground">{job.name}</p>

					{!summaries.enabled ? (
						<div className="max-w-[440px]">
							<AiNeeded text={m.transcriptReviewEmpty()} />
						</div>
					) : (
						thread.length === 0 &&
						!asking &&
						!reviewing && (
							<p className="mb-6 max-w-[520px] text-[14px] leading-[1.55] text-muted-foreground">
								{summaries.tyto ? m.transcriptReviewEmpty() : m.transcriptAskEmpty()}
							</p>
						)
					)}

					{canReview && (
						<div className="mb-8">
							<Button size="sm" disabled={reviewing} onClick={() => void summaries.review(job)}>
								{reviewing ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
								{reviewing ? m.tytoAiReviewLoading() : m.tytoAiReviewRun()}
							</Button>
							{thread.length === 0 && <p className="mt-2 text-[12px] text-muted-foreground">{m.tytoAiReviewInfo()}</p>}
						</div>
					)}

					{(thread.length > 0 || asking) && (
						<div className="space-y-8">
							{thread.map((entry, index) => (
								<div key={index} className="group">
									<div className="flex items-start gap-3">
										{/* A review is saved under its own title as the "question": no chat bubble for it. */}
										{entry.question === m.tytoAiReview() ? (
											<span className="flex-1" />
										) : (
											<p className="flex-1 rounded-2xl bg-muted/60 px-4 py-2.5 text-sm text-foreground">{entry.question}</p>
										)}
										<button
											type="button"
											onClick={() => summaries.removeThreadEntry(job, index)}
											aria-label={m.removeQuestion()}
											className="mt-2 cursor-pointer rounded-full p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100">
											<X className="h-3.5 w-3.5" />
										</button>
									</div>
									<div className={cn('prose prose-neutral mt-3 max-w-none ps-1 dark:prose-invert', textSizeClass[options.textSize])}>
										<Markdown>{entry.answer}</Markdown>
									</div>
								</div>
							))}
							{asking && (
								<div>
									{sent && <p className="mb-3 rounded-2xl bg-muted/60 px-4 py-2.5 text-sm text-foreground">{sent}</p>}
									{answerDraft ? (
										<Streaming text={answerDraft} size={options.textSize} />
									) : (
										<p className="flex items-center gap-2 text-sm text-muted-foreground">
											<Spinner className="h-3.5 w-3.5" />
											<Sparkles className="h-3.5 w-3.5" />
										</p>
									)}
								</div>
							)}
						</div>
					)}
				</div>
			</div>

			{canAsk && (
				// Floats over the end of the page like a chat box, so the question is always one keystroke away.
				<div
					dir={preference.textAreaDirection}
					className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/90 to-transparent pt-8 pb-5">
					<form
						onSubmit={(event) => {
							event.preventDefault()
							send()
						}}
						className="pointer-events-auto mx-auto flex w-[calc(100%-4rem)] max-w-[calc(86ch-4rem)] items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-lg xl:max-w-[calc(96ch-4rem)]">
						<textarea
							ref={inputRef}
							value={question}
							onChange={(event) => setQuestion(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' && !event.shiftKey) {
									event.preventDefault()
									send()
								}
							}}
							rows={1}
							aria-label={m.askTranscript()}
							placeholder={m.askPlaceholder()}
							className="max-h-32 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground/70"
						/>
						<Button
							type="submit"
							size="iconSm"
							className="h-7 w-7 shrink-0 rounded-full"
							disabled={!question.trim() || asking}
							aria-label={m.askSend()}>
							{asking ? <Spinner className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
						</Button>
					</form>
				</div>
			)}
		</div>
	)
}
