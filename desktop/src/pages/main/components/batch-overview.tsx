import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { cn } from '~/lib/style'
import { batchSecondsLeft, timeLeftLabel } from '~/lib/tyto/progress-eta'
import type { Job } from '../hooks/use-transcribe-queue'
import { useSession } from '../session'
import BatchBanner from './batch-banner'
import { RunBar, useNow } from './run-progress'

/** «Расшифровка 5 файлов»: the plural form from the locale's rules. */
function filesTitle(count: number) {
	const form = new Intl.PluralRules(getLocale()).select(count)
	const value = { count: String(count) }
	if (form === 'one') return m.progressFilesOne(value)
	if (form === 'few') return m.progressFilesFew(value)
	return m.progressFilesMany(value)
}

/** «42:10» / «1:04:33» from the end of the last line, once the text is there. */
function fileLength(job: Job) {
	if (job.status !== 'done') return ''
	const total = Math.round((job.segments[job.segments.length - 1]?.stop ?? 0) / 100)
	if (total <= 0) return ''
	const h = Math.floor(total / 3600)
	const mm = String(Math.floor((total % 3600) / 60)).padStart(h ? 2 : 1, '0')
	const ss = String(total % 60).padStart(2, '0')
	return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function FileStatus({ job }: { job: Job }) {
	switch (job.status) {
		case 'running':
			return (
				<>
					<RunBar percent={job.progress} label={job.name} size="sm" />
					<span className="font-mono text-[12.5px] tabular-nums">{Math.round(job.progress)}%</span>
				</>
			)
		case 'done':
			return <span>{m.progressDone()}</span>
		case 'error':
			return (
				<span className="truncate text-destructive" title={job.error}>
					{m.progressError()}
				</span>
			)
		case 'cancelled':
			return <span className="text-muted-foreground">{m.progressCancelled()}</span>
		default:
			return <span className="text-[var(--tyto-faint)]">{m.progressQueued()}</span>
	}
}

/**
 * Several files at once (design round 4, variant C): one page for the whole run in place of the
 * transcript. «2 из 5 готово», the time left and one bar for everything; under it the files, and a
 * finished (or running) one opens its transcript with a click.
 */
export default function BatchOverview({ onOpen }: { onOpen: (id: string) => void }) {
	const { queue } = useSession()
	const jobs = queue.jobs
	const total = jobs.length
	const done = jobs.filter((job) => job.status === 'done').length
	const settled = jobs.filter((job) => job.status !== 'queued' && job.status !== 'running').length
	const running = jobs.find((job) => job.status === 'running')
	const queued = jobs.filter((job) => job.status === 'queued').length
	const now = useNow(queue.running)
	const left = queue.running
		? batchSecondsLeft({ queued, secondsPerFile: queue.batch?.secondsPerFile ?? null, running, now })
		: null
	const percent = total ? ((settled + (running ? running.progress / 100 : 0)) / total) * 100 : 0

	return (
		<div className="h-full min-h-0 overflow-y-auto">
			<div className="mx-auto flex w-full max-w-[86ch] flex-col gap-6 px-12 pt-16 pb-10">
				<header className="flex flex-col gap-2.5">
					<h1 className="text-[24px] font-semibold tracking-[-0.02em] text-foreground">{filesTitle(total)}</h1>
					<div className="flex items-baseline gap-2.5 text-[13.5px]">
						<span className="text-foreground tabular-nums">{m.progressDoneOf({ done: String(done), total: String(total) })}</span>
						{left != null && <span className="text-[13px] text-muted-foreground">{timeLeftLabel(left)}</span>}
						<span className="flex-1" />
						{queue.running && (
							<button type="button" onClick={queue.cancelAll} disabled={queue.isAborting} className="tyto-quiet-link">
								{queue.isAborting ? m.aborting() : m.progressStopAll()}
							</button>
						)}
					</div>
					<RunBar percent={percent} label={filesTitle(total)} />
				</header>

				<BatchBanner />

				<ul className="border-t border-border">
					{jobs.map((job) => {
						const openable = job.status === 'done' || job.status === 'running'
						return (
							<li key={job.id} className="border-b border-border">
								<button
									type="button"
									disabled={!openable}
									onClick={() => onOpen(job.id)}
									className={cn(
										'grid min-h-12 w-full grid-cols-[minmax(0,1fr)_72px_150px] items-center gap-4 px-1 text-start transition-colors duration-150',
										openable ? 'cursor-pointer hover:bg-[var(--tyto-line-active)]' : 'cursor-default',
										job.status === 'running' && 'bg-[var(--tyto-line-active)]',
									)}>
									<span className={cn('truncate text-[14px] text-foreground', job.status === 'running' && 'font-medium')}>{job.name}</span>
									<span className="text-end font-mono text-[12px] text-muted-foreground tabular-nums">{fileLength(job)}</span>
									<span className="flex min-w-0 items-center justify-end gap-2 text-[13px] text-foreground">
										<FileStatus job={job} />
									</span>
								</button>
							</li>
						)
					})}
				</ul>

				{queue.running && <p className="text-[12.5px] text-muted-foreground">{m.progressOpenHint()}</p>}
			</div>
		</div>
	)
}
