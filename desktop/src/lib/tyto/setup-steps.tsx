import { Check, Lock, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
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

type StepState = 'waiting' | 'active' | 'done'

/**
 * First run (docs/design/2026-10-25-tyto-visual-language.md, «Первый запуск»): title, the
 * walking owl (the only owl on this screen, owner's call 2026-10-26), what is being downloaded and why, two steps with size and time left, privacy line and
 * two labelled ways out. Without a connection the same column explains it in place of a modal.
 */
export function SetupSteps({ vm }: { vm: SetupStepsModel }) {
	const offline = vm.isOnline === false
	const eta = useEta(vm.bytes)
	const stateOf = (step: SetupStepsModel['step']): StepState => (vm.step === step ? 'active' : step === 'speech' ? 'done' : 'waiting')

	return (
		<div className="flex min-h-screen items-center justify-center px-4 py-12">
			<div className="w-full max-w-[460px]">
				<h1 className="tyto-title-screen text-balance">{m.downloadingModel()}</h1>
				<OwlWalk walking={!offline} />

				{offline ? (
					<div className="mt-6">
						<WifiOff className="size-6 text-muted-foreground" aria-hidden="true" />
						<h2 className="tyto-title-dialog mt-4">{m.noConnection()}</h2>
						<p className="mt-2 text-sm text-muted-foreground">{m.infoManualDownload()}</p>
						<div className="mt-6 flex items-center gap-2">
							<Button variant="primary" onClick={vm.downloadIfOnline}>
								{m.tryAgain()}
							</Button>
							<Button variant="ghost" onClick={vm.cancelSetup}>
								{m.setupManualFile()}
							</Button>
						</div>
					</div>
				) : (
					<>
						<p className="mt-2 text-[15px] leading-[1.55] text-muted-foreground">{m.setupIntro()}</p>
						<ol className="mt-6 rounded-[var(--tyto-r-lg)] border border-border">
							<Step
								n={1}
								state={stateOf('speech')}
								title={m.setupStepSpeech()}
								description={m.setupStepSpeechDescription()}
								bytes={vm.bytes}
								eta={eta}
							/>
							{vm.speakersEnabled && (
								<Step
									n={2}
									state={stateOf('speakers')}
									title={m.setupStepSpeakers()}
									description={m.setupStepSpeakersDescription()}
									bytes={vm.bytes}
									eta={eta}
								/>
							)}
						</ol>
						<p className="mt-4 flex items-start gap-2 text-[13px] leading-[1.45] text-muted-foreground">
							<Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
							<span>{m.setupPrivacy()}</span>
						</p>
						<div className="mt-6 flex items-center gap-2">
							<Button variant="secondary" size="sm" onClick={vm.cancelSetup}>
								{m.setupCancelDownload()}
							</Button>
							<Button variant="ghost" size="sm" onClick={vm.cancelSetup}>
								{m.iPreferManualSetup()}
							</Button>
						</div>
					</>
				)}
			</div>
		</div>
	)
}

function Step({
	n,
	state,
	title,
	description,
	bytes,
	eta,
}: {
	n: 1 | 2
	state: StepState
	title: string
	description: string
	bytes: [number, number] | null
	eta: number | null
}) {
	const active = state === 'active'
	const fraction = active && bytes && bytes[1] > 0 ? Math.min(1, bytes[0] / bytes[1]) : 0
	const right = state === 'waiting' ? m.setupStepNext() : state === 'done' ? m.setupStepDone() : bytes ? formatSize(bytes) : null

	return (
		<li data-testid={`setup-step-${n}`} data-state={state} className={`grid grid-cols-[24px_1fr_auto] items-start gap-3 p-4 ${n > 1 ? 'border-t border-border' : ''}`}>
			<span
				className={`flex size-6 items-center justify-center rounded-full border text-[12px] font-medium tabular-nums ${
					state === 'waiting' ? 'border-[var(--tyto-track)] text-muted-foreground' : 'border-foreground text-foreground'
				}`}>
				{state === 'done' ? <Check className="size-3.5" aria-label={m.setupStepDone()} /> : n}
			</span>
			<div>
				<div className="text-sm font-medium">{title}</div>
				<div className="mt-0.5 text-[12.5px] leading-[1.45] text-muted-foreground">{description}</div>
			</div>
			<div className="pt-0.5 text-right text-[12.5px] text-muted-foreground tabular-nums">{right}</div>
			{active && (
				<div className="col-start-2 col-end-4 mt-3">
					<div
						role="progressbar"
						aria-label={title}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(fraction * 100)}
						className="h-[3px] overflow-hidden rounded-[2px] bg-[var(--tyto-track)]">
						<div
							className="h-full w-full origin-left bg-foreground transition-transform duration-200 ease-[var(--tyto-ease)] motion-reduce:transition-none"
							style={{ transform: `scaleX(${fraction})` }}
						/>
					</div>
					{bytes && (
						<div className="mt-2 flex justify-between text-[12px] text-muted-foreground tabular-nums">
							<span>{Math.round(fraction * 100)}%</span>
							<span>{formatEta(eta)}</span>
						</div>
					)}
				</div>
			)}
		</li>
	)
}

/** «1,0 из 1,6 ГБ» for the big model, «20 из 40 МБ» for files under a gigabyte (decimal units). */
function formatSize([current, total]: [number, number]) {
	const locale = getLocale()
	if (total >= 1e9) {
		const gb = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
		return m.setupSizeGb({ current: gb.format(current / 1e9), total: gb.format(total / 1e9) })
	}
	const mb = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
	return m.setupSizeMb({ current: mb.format(current / 1e6), total: mb.format(total / 1e6) })
}

function formatEta(eta: number | null) {
	if (eta === null) return ''
	if (eta < 60) return m.setupEtaUnderMinute()
	return m.setupEtaMinutes({ minutes: String(Math.round(eta / 60)) })
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
