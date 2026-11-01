import { useEffect, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { cn } from '~/lib/style'
import { m } from '~/paraglide/messages.js'
import { type CaptureTarget, type CaptureTargets, listCaptureTargets } from './screen-recording'
import { SegmentedControl } from './segmented-control'

type Kind = 'screen' | 'window'

const optionClass = (selected: boolean) =>
	cn(
		'flex w-full cursor-pointer flex-col items-start rounded-[var(--tyto-r-sm)] border px-3 py-2 text-start text-sm focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground focus-visible:outline-offset-2',
		selected ? 'tyto-selected border-foreground' : 'border-border hover:bg-muted/60',
	)

/**
 * «Что записывать»: the whole screen (a monitor to pick when there are several) or one window.
 * The backend leaves Tyto's own windows out of the list.
 */
export function CaptureTargetDialog({ open, onCancel, onStart }: { open: boolean; onCancel: () => void; onStart: (target: CaptureTarget) => void }) {
	const [targets, setTargets] = useState<CaptureTargets | null>(null)
	const [kind, setKind] = useState<Kind>('screen')
	const [monitorId, setMonitorId] = useState<string | null>(null)
	const [windowId, setWindowId] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		let cancelled = false
		setTargets(null)
		setKind('screen')
		setWindowId(null)
		listCaptureTargets()
			.then((found) => {
				if (cancelled) return
				setTargets(found)
				setMonitorId((found.monitors.find((monitor) => monitor.primary) ?? found.monitors[0])?.id ?? null)
			})
			.catch((error) => {
				console.error('listCaptureTargets error: ', error)
				if (!cancelled) setTargets({ monitors: [], windows: [] })
			})
		return () => {
			cancelled = true
		}
	}, [open])

	const monitors = targets?.monitors ?? []
	const windows = targets?.windows ?? []
	const target: CaptureTarget | null =
		kind === 'screen' ? (monitorId ? { kind: 'monitor', id: monitorId } : null) : windowId ? { kind: 'window', id: windowId } : null

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
			<DialogContent aria-describedby={undefined} className="max-w-md">
				<DialogHeader>
					<DialogTitle>{m.tytoCaptureTitle()}</DialogTitle>
				</DialogHeader>

				<SegmentedControl
					ariaLabel={m.tytoCaptureTitle()}
					value={kind}
					onChange={setKind}
					options={[
						{ value: 'screen', label: m.tytoCaptureScreen() },
						{ value: 'window', label: m.tytoCaptureWindow() },
					]}
				/>

				{kind === 'screen' && monitors.length > 1 && (
					<div role="radiogroup" aria-label={m.tytoCaptureScreen()} className="flex flex-col gap-1.5">
						{monitors.map((monitor, index) => (
							<button
								key={monitor.id}
								type="button"
								role="radio"
								aria-checked={monitor.id === monitorId}
								onClick={() => setMonitorId(monitor.id)}
								className={optionClass(monitor.id === monitorId)}>
								{m.tytoCaptureMonitor({ index: String(index + 1), width: String(monitor.width), height: String(monitor.height) })}
							</button>
						))}
					</div>
				)}

				{kind === 'window' &&
					(windows.length === 0 ? (
						<p className="py-4 text-center text-sm text-muted-foreground">{m.tytoCaptureNoWindows()}</p>
					) : (
						<div role="radiogroup" aria-label={m.tytoCaptureWindow()} className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
							{windows.map((window) => (
								<button
									key={window.id}
									type="button"
									role="radio"
									aria-checked={window.id === windowId}
									onClick={() => setWindowId(window.id)}
									className={optionClass(window.id === windowId)}>
									<span className="w-full truncate">{window.title}</span>
									<span className="w-full truncate text-xs opacity-70">{window.appName}</span>
								</button>
							))}
						</div>
					))}

				<DialogFooter className="gap-2 sm:gap-0">
					<Button variant="secondary" onClick={onCancel}>
						{m.tytoCancel()}
					</Button>
					<Button disabled={!target} onClick={() => target && onStart(target)}>
						{m.tytoCaptureStart()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
