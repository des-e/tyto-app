import { useMemo } from 'react'
import { m } from '~/paraglide/messages.js'
import { splitSummary } from '~/lib/ai'
import { cn } from '~/lib/style'
import { usePreferenceProvider } from '~/providers/preference'
import { PLAYER_SEEK_EVENT } from './player-bar'
import type { Job } from '../hooks/use-transcribe-queue'
import { textSizeClass, type TranscriptViewOptions } from '../hooks/use-transcript-view'

/**
 * «Темы»: the recording's table of contents from the Tyto AI summary. A click moves the player to
 * where the topic starts, the same way a click on a line's time does in the text.
 */
export default function TopicsView({ job, options }: { job: Job; options: TranscriptViewOptions }) {
	const preference = usePreferenceProvider()
	const topics = useMemo(() => splitSummary(job.summary ?? '').topics, [job.summary])

	return (
		<div className="h-full min-h-0 overflow-x-hidden overflow-y-auto">
			<div dir={preference.textAreaDirection} className="mx-auto w-full max-w-[86ch] px-8 py-10 xl:max-w-[96ch]">
				<p className="mb-6 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{m.topicsTab()}</p>
				{topics.length === 0 ? (
					<p className="text-sm text-muted-foreground">{m.topicsComingSoon()}</p>
				) : (
					<ol className="space-y-0.5">
						{topics.map((topic, index) => (
							<li key={`${topic.start}-${index}`}>
								<button
									type="button"
									onClick={() => window.dispatchEvent(new CustomEvent(PLAYER_SEEK_EVENT, { detail: { seconds: topic.seconds } }))}
									className={cn(
										'-mx-3 flex w-[calc(100%+1.5rem)] cursor-pointer items-baseline gap-4 rounded-[var(--tyto-r-sm)] px-3 py-2 text-start transition-colors duration-150 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-foreground',
										textSizeClass[options.textSize],
									)}>
									<span className="w-16 shrink-0 font-mono text-[12.5px] text-muted-foreground tabular-nums">{topic.start}</span>
									<span className="text-foreground">{topic.title}</span>
								</button>
							</li>
						))}
					</ol>
				)}
			</div>
		</div>
	)
}
