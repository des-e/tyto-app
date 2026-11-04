import { useEffect, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { fileSecondsLeft, timeLeftLabel } from '~/lib/tyto/progress-eta'

/** Date.now(), refreshed every second while `active`, so a time-left line keeps moving. */
export function useNow(active: boolean) {
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		if (!active) return
		setNow(Date.now())
		const timer = window.setInterval(() => setNow(Date.now()), 1000)
		return () => window.clearInterval(timer)
	}, [active])
	return now
}

/** The 4 px bar under a progress line (theme.css `.tyto-run-bar`). */
export function RunBar({ percent, label, size }: { percent: number; label: string; size?: 'sm' }) {
	const value = Math.max(0, Math.min(100, Math.round(percent)))
	return (
		<div role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} data-size={size} className="tyto-run-bar">
			<span style={{ width: `${value}%` }} />
		</div>
	)
}

/**
 * «Расшифровываем 64% · осталось около 3 мин · Остановить» and the bar under the title of a running
 * transcript (design round 4, variant A). The lines appear below as they are recognised.
 */
export default function RunProgress({
	progress,
	startedAt,
	stopping,
	onStop,
}: {
	progress: number
	startedAt?: number
	stopping: boolean
	onStop: () => void
}) {
	const now = useNow(true)
	const left = fileSecondsLeft(progress, startedAt, now)
	const started = progress > 0

	return (
		<section aria-label={m.progressTranscribing()} className="tyto-doc-indent mb-6 flex max-w-[560px] flex-col gap-2">
			<div className="flex items-baseline gap-2.5 text-[13.5px]">
				<span className="font-medium text-foreground">{started ? m.progressTranscribing() : m.progressPreparing()}</span>
				{started && <span className="font-mono text-[12.5px] text-foreground tabular-nums">{Math.round(progress)}%</span>}
				{left != null && <span className="text-[13px] text-muted-foreground">{timeLeftLabel(left)}</span>}
				<span className="flex-1" />
				<button type="button" onClick={onStop} disabled={stopping} className="tyto-quiet-link">
					{stopping ? m.aborting() : m.progressStop()}
				</button>
			</div>
			<RunBar percent={progress} label={m.progressTranscribing()} />
		</section>
	)
}
