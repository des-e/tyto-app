import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { PLAYER_SEEK_EVENT, PLAYER_TIME_EVENT, type PlayerTimeDetail } from './player-bar'
import type { Job } from '../hooks/use-transcribe-queue'
import { AiNeeded, SummaryWorking, useSummaryState } from './summary-view'

/** «00:00:37» → «00:37»; «01:02:03» → «1:02:03». The model writes hours even for a 10-minute call. */
export function topicTime(start: string): string {
	const parts = start.split(':')
	if (parts.length === 3 && Number(parts[0]) === 0) return `${parts[1]}:${parts[2]}`
	if (parts.length === 3) return `${Number(parts[0])}:${parts[1]}:${parts[2]}`
	return start
}

/**
 * «Темы» as a column at the right of the text (design round 3): the recording's table of contents.
 * A click moves the player to where the topic starts; the topic being played sits on a grey plate.
 */
export default function TopicsColumn({ job }: { job: Job }) {
	const { summaries, summarizing, progress, error, canSummarize, parts } = useSummaryState(job)
	const topics = parts.topics
	const [seconds, setSeconds] = useState(0)

	useEffect(() => {
		function onTime(event: Event) {
			const detail = (event as CustomEvent<PlayerTimeDetail>).detail
			if (detail && Number.isFinite(detail.seconds)) setSeconds(detail.seconds)
		}
		window.addEventListener(PLAYER_TIME_EVENT, onTime)
		return () => window.removeEventListener(PLAYER_TIME_EVENT, onTime)
	}, [])

	let current = -1
	topics.forEach((topic, index) => {
		if (topic.seconds <= seconds) current = index
	})

	let body: React.ReactNode
	if (topics.length > 0) {
		body = (
			<ol className="flex flex-col gap-0.5" data-hours={topics.some((topic) => topic.seconds >= 3600) || undefined}>
				{topics.map((topic, index) => (
					<li key={`${topic.start}-${index}`}>
						<button
							type="button"
							aria-current={index === current ? 'true' : undefined}
							onClick={() => window.dispatchEvent(new CustomEvent(PLAYER_SEEK_EVENT, { detail: { seconds: topic.seconds } }))}
							className="tyto-topic">
							<span className="tyto-topic-time">{topicTime(topic.start)}</span>
							<span>{topic.title}</span>
						</button>
					</li>
				))}
			</ol>
		)
	} else if (summarizing) {
		body = (
			<div className="px-2">
				<SummaryWorking progress={progress} />
			</div>
		)
	} else if (!summaries.enabled && !job.summary) {
		body = (
			<div className="px-2">
				<AiNeeded text={m.transcriptTopicsNeedAi()} />
			</div>
		)
	} else if (job.summary || error) {
		// An older summary (or one from another service) came without topics: making it again adds them.
		body = (
			<div className="space-y-2.5 px-2">
				<p className="text-[13px] leading-[1.5] text-muted-foreground">{error ? m.summaryFailed() : m.transcriptTopicsNone()}</p>
				{canSummarize && (
					<Button size="sm" variant="outline" onClick={() => void summaries.summarize(job)}>
						{error ? m.retrySummary() : m.regenerateSummary()}
					</Button>
				)}
			</div>
		)
	} else if (canSummarize) {
		body = (
			<div className="px-2">
				<Button size="sm" variant="outline" onClick={() => void summaries.summarize(job)}>
					<Sparkles className="h-3.5 w-3.5" />
					{m.transcriptMakeSummary()}
				</Button>
			</div>
		)
	}

	return (
		<aside aria-labelledby={`topics-${job.id}`} className="w-[216px] shrink-0 overflow-y-auto border-s border-border px-3 pt-3 pb-6">
			<h2 id={`topics-${job.id}`} className="mx-2 mb-2 text-[12px] font-medium text-muted-foreground">
				{m.topicsTab()}
			</h2>
			{body}
		</aside>
	)
}
