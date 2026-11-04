import { WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { m } from '~/paraglide/messages.js'
import { estimateEta, type DownloadSample } from './download-eta'
import { OwlWalk } from './owl-walk'

/** What the first-run screen needs from pages/setup/view-model. */
export interface SetupStepsModel {
	/** The model downloading now: speech recognition first, then the speakers model. */
	step: 'speech' | 'speakers'
	/** Raw `download_progress` of the current download, null before its first event. */
	bytes: [number, number] | null
	isOnline: boolean | null
	speakersEnabled: boolean
	cancelSetup: () => void
	downloadIfOnline: () => void
}

/** Share of the whole download taken by speech recognition when the speakers model follows (1,6 GB vs ~0,2 GB). */
const SPEECH_SHARE = 0.9

/** Both models as one percentage: speech recognition first, then the speakers model. */
export function overallPercent(step: SetupStepsModel['step'], bytes: [number, number] | null, speakersEnabled: boolean): number {
	const fraction = bytes && bytes[1] > 0 ? Math.min(1, bytes[0] / bytes[1]) : 0
	if (!speakersEnabled) return Math.round((step === 'speech' ? fraction : 1) * 100)
	const whole = step === 'speech' ? fraction * SPEECH_SHARE : SPEECH_SHARE + fraction * (1 - SPEECH_SHARE)
	return Math.round(whole * 100)
}

/**
 * Quiet first run (design round 6): the walking owl, «Tyto готовится · 17%», one thin bar for both
 * models, one line about the download, and two small ways out at the bottom. Without a connection
 * the same place says so and offers to try again.
 */
export function SetupSteps({ vm }: { vm: SetupStepsModel }) {
	const offline = vm.isOnline === false
	const eta = useEta(vm.bytes)
	const percent = overallPercent(vm.step, vm.bytes, vm.speakersEnabled)
	const note = eta === null ? m.setupOnce() : eta < 60 ? m.setupOnceSoon() : m.setupOnceEta({ minutes: String(Math.round(eta / 60)) })

	return (
		<div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12 text-center">
			{/* The owl walks over the width of the bar. */}
			<div className="w-[220px]">
				<OwlWalk walking={!offline} />
			</div>

			{offline ? (
				<>
					<h1 className="mt-6 flex items-center gap-2 text-[15px] font-medium text-foreground">
						<WifiOff className="size-4 text-muted-foreground" aria-hidden="true" />
						{m.noConnection()}
					</h1>
					<p className="mt-2 max-w-[360px] text-[13px] leading-[1.5] text-muted-foreground">{m.infoManualDownload()}</p>
					<Button variant="primary" size="sm" className="mt-5" onClick={vm.downloadIfOnline}>
						{m.tryAgain()}
					</Button>
				</>
			) : (
				<>
					<h1 className="mt-6 text-[15px] font-medium text-foreground">
						{m.setupPreparing()} <span className="font-normal text-muted-foreground">·</span>{' '}
						<span className="font-mono text-[14px] tabular-nums">{percent}%</span>
					</h1>
					<div
						role="progressbar"
						aria-label={m.setupProgress()}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={percent}
						className="mt-3.5 h-[3px] w-[220px] overflow-hidden rounded-[2px] bg-[var(--tyto-track)]">
						<div
							className="h-full w-full origin-left bg-foreground transition-transform duration-200 ease-[var(--tyto-ease)] motion-reduce:transition-none"
							style={{ transform: `scaleX(${percent / 100})` }}
						/>
					</div>
					<p className="mt-3.5 text-[13px] text-muted-foreground">{note}</p>
				</>
			)}

			<div className="absolute bottom-7 flex gap-[18px] text-[12.5px] text-muted-foreground">
				<button type="button" onClick={vm.cancelSetup} className="cursor-pointer hover:text-foreground">
					{m.setupManual()}
				</button>
				{!offline && (
					<button type="button" onClick={vm.cancelSetup} className="cursor-pointer hover:text-foreground">
						{m.setupCancel()}
					</button>
				)}
			</div>
		</div>
	)
}

/** Remaining seconds of the current download, from the progress events seen so far. */
function useEta(bytes: [number, number] | null) {
	const samples = useRef<DownloadSample[]>([])
	const [eta, setEta] = useState<number | null>(null)
	useEffect(() => {
		if (!bytes) {
			samples.current = []
			setEta(null)
			return
		}
		const now = performance.now()
		samples.current.push({ t: now, bytes: bytes[0] })
		// Old samples only matter for the "3 s elapsed" rule, which the oldest kept one still covers.
		while (samples.current.length > 2 && now - samples.current[1].t > 10_000) samples.current.shift()
		setEta(estimateEta(samples.current, bytes[1]))
	}, [bytes])
	return eta
}
