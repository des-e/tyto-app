import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { useSession } from '../session'
import { useTranscriptViewOptions, type TranscriptTab } from '../hooks/use-transcript-view'
import BatchOverview from './batch-overview'
import TranscriptToolbar from './transcript-toolbar'
import TranscriptView from './transcript-view'

export default function SessionView() {
	const { queue, summaries, batchOverview, setBatchOverview } = useSession()
	const [query, setQuery] = useState('')
	const [tab, setTab] = useState<TranscriptTab>('transcript')
	const options = useTranscriptViewOptions()
	const multiple = queue.jobs.length > 1
	const selected = queue.selectedJob

	useEffect(() => {
		setQuery('')
		setTab('transcript')
	}, [queue.selectedId])

	// A summary that starts, by hand or on its own, turns its block and the topics on, so it is seen arriving.
	const { setShowSummary, setShowTopics } = options
	useEffect(() => {
		if (!summaries.showSummary) return
		if (summaries.showSummary === queue.selectedId) {
			setShowSummary(true)
			setShowTopics(true)
			setTab('transcript')
		}
		summaries.clearShowSummary()
	}, [queue.selectedId, summaries, setShowSummary, setShowTopics])

	// Several files open on their overview (design round 4, variant C); a file opens from there.
	function open(id: string) {
		queue.selectJob(id)
		setBatchOverview(false)
	}

	const done = queue.jobs.filter((job) => job.status === 'done').length

	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.25, ease: 'easeOut' }}
			className="flex min-h-0 flex-1 flex-col">
			{batchOverview ? (
				<BatchOverview onOpen={open} />
			) : (
				<>
					{multiple && (
						<div className="flex h-9 shrink-0 items-center ps-8 pe-4">
							<button type="button" onClick={() => setBatchOverview(true)} className="tyto-quiet-link inline-flex items-center gap-1.5 no-underline">
								<ArrowLeft aria-hidden className="h-3.5 w-3.5" />
								{m.progressAllFiles()}
								<span className="font-mono text-[12px] tabular-nums">
									· {m.progressDoneOf({ done: String(done), total: String(queue.jobs.length) })}
								</span>
							</button>
						</div>
					)}
					<TranscriptToolbar job={selected} query={query} setQuery={setQuery} options={options} tab={tab} setTab={setTab} />
					<div className="min-h-0 flex-1">{selected && <TranscriptView job={selected} query={query} options={options} tab={tab} />}</div>
				</>
			)}
		</motion.div>
	)
}
