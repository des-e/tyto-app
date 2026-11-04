import { Check, FolderOpen, X } from 'lucide-react'
import { useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { openPath } from '~/lib/app'
import { useSession } from '../session'

/**
 * When the last file of a batch completes: one card with the counts and a way to the files, on the
 * batch overview (batch-overview.tsx). It stays until dismissed so a result seen hours later is still there.
 */
export default function BatchBanner() {
	const { queue } = useSession()
	const [details, setDetails] = useState(false)
	const { batchSummary } = queue

	if (!batchSummary) return null
	const summary = batchSummary
	const minutes = Math.max(1, Math.round(summary.seconds / 60))
	const exportedAny = summary.exported + summary.skipped + summary.fallback + summary.failed > 0

	return (
		<div className="rounded-xl border border-border bg-muted/50 px-3.5 py-3 text-[12px]">
			<div className="flex items-start gap-3">
				<span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
					<Check className="h-3 w-3" strokeWidth={2.6} />
				</span>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-foreground">{m.batchFinishedHeadline({ total: String(summary.total), minutes: String(minutes) })}</p>
					<p className="mt-0.5 text-muted-foreground">
						{exportedAny
							? [
									m.batchCountExported({ count: String(summary.exported) }),
									summary.skipped > 0 && m.batchCountSkipped({ count: String(summary.skipped) }),
									summary.fallback > 0 && m.batchCountFallback({ count: String(summary.fallback) }),
									summary.failed > 0 && m.batchCountFailed({ count: String(summary.failed) }),
								]
									.filter(Boolean)
									.join(', ')
							: m.batchFinishedFiles({ count: String(summary.total) })}
						{summary.exceptions.length > 0 && (
							<>
								{' · '}
								<button
									type="button"
									onClick={() => setDetails((value) => !value)}
									className="cursor-pointer text-primary underline-offset-4 hover:underline">
									{details ? m.batchHideDetails() : m.batchShowDetails()}
								</button>
							</>
						)}
					</p>
					{details && (
						<ul className="mt-2 space-y-1 text-muted-foreground">
							{summary.exceptions.map((item) => (
								<li key={item.name} className="truncate">
									<span className="text-foreground">{item.name}</span> · {item.detail}
								</li>
							))}
						</ul>
					)}
				</div>
				{summary.folder && (
					<Button size="sm" onClick={() => void openPath({ name: '', path: summary.folder! })}>
						<FolderOpen className="h-3.5 w-3.5" />
						{m.openFolder()}
					</Button>
				)}
				<button
					type="button"
					onClick={queue.dismissBatchSummary}
					aria-label={m.dismiss()}
					className="cursor-pointer rounded-full p-1 text-muted-foreground hover:text-foreground">
					<X className="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	)
}
