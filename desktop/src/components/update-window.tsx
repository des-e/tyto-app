import { useContext } from 'react'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { UpdaterContext } from '~/providers/updater'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Progress } from '~/components/ui/progress'
import { OwlWalk } from '~/lib/tyto/owl-walk'
import { downloadSizeLabel } from '~/lib/tyto/format'

/**
 * The one window of an update: «Доступна версия» -> «Скачиваю обновление» (walking owl, percent, size)
 * -> «Устанавливаю» -> «Готово». It replaces the two native dialogs and the old progress dialog.
 * While the app downloads or installs, the window cannot be closed.
 */
export default function UpdateWindow() {
	const { phase, version, notes, progress, downloaded, total, startUpdate, dismissUpdate, relaunchApp } = useContext(UpdaterContext)

	const busy = phase === 'downloading' || phase === 'installing'
	const open = phase !== 'idle' && phase !== 'error'
	const percent = progress === null ? null : Math.floor(progress)

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) dismissUpdate()
			}}>
			<DialogContent
				className={`sm:max-w-md ${busy ? '[&>button:last-child]:hidden' : ''}`}
				data-testid="update-window"
				onInteractOutside={(e) => busy && e.preventDefault()}
				onEscapeKeyDown={(e) => busy && e.preventDefault()}>
				{phase === 'confirm' && (
					<>
						<DialogHeader>
							<DialogTitle>{m.updateWindowTitle({ version })}</DialogTitle>
							<DialogDescription asChild>
								<div className="max-h-48 overflow-y-auto whitespace-pre-wrap text-start text-xs">{notes || m.updateWindowNotesFallback()}</div>
							</DialogDescription>
						</DialogHeader>
						<DialogFooter className="gap-2 sm:gap-0">
							<Button variant="secondary" onClick={dismissUpdate}>
								{m.later()}
							</Button>
							<Button onClick={startUpdate}>{m.updateWindowConfirm()}</Button>
						</DialogFooter>
					</>
				)}
				{busy && (
					<>
						<DialogHeader>
							<DialogTitle>{phase === 'downloading' ? m.updateWindowDownloadingTitle() : m.updateWindowInstallingTitle()}</DialogTitle>
						</DialogHeader>
						<OwlWalk walking={true} />
						<div>
							{phase === 'downloading' && percent !== null ? (
								<Progress value={progress ?? 0} className="progress-aurora h-1.5 w-full bg-muted" />
							) : (
								<Progress value={100} className="progress-aurora h-1.5 w-full animate-pulse bg-muted" />
							)}
							{phase === 'downloading' && (
								<div className="mt-2 flex justify-between text-xs text-muted-foreground tabular-nums">
									<span>{percent !== null ? `${percent} %` : ''}</span>
									<span>{downloadSizeLabel(downloaded, total, getLocale())}</span>
								</div>
							)}
						</div>
						<DialogDescription className="text-xs">{m.updateWindowKeepOpen()}</DialogDescription>
					</>
				)}
				{phase === 'done' && (
					<>
						<DialogHeader>
							<DialogTitle>{m.updateWindowDoneTitle()}</DialogTitle>
							<DialogDescription>{m.updateWindowDoneBody({ version })}</DialogDescription>
						</DialogHeader>
						<DialogFooter className="gap-2 sm:gap-0">
							<Button variant="secondary" onClick={dismissUpdate}>
								{m.later()}
							</Button>
							<Button onClick={relaunchApp}>{m.updateWindowRelaunch()}</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	)
}
