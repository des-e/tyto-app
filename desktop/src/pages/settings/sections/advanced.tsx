import { RotateCcw } from 'lucide-react'
import { useContext } from 'react'
import { m } from '~/paraglide/messages.js'
import { UpdaterContext, devToolsEnabled } from '~/providers/updater'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import NumberField from '~/components/number-field'
import { ReactComponent as CopyIcon } from '~/icons/copy.svg'
import { ReactComponent as FolderIcon } from '~/icons/folder.svg'
import { ReactComponent as ResetIcon } from '~/icons/reset.svg'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { DEFAULT_MODEL_OPTIONS, type CpuVariant } from '~/providers/preference'
import { ActionRow, SettingsGroup, SettingsRow, rowControlClass, type SettingsViewModel } from './shared'

/** Whisper's decoding knobs and the custom FFmpeg command (moved here from «Тонкая настройка», design round 8). */
function WhisperGroup({ vm }: { vm: SettingsViewModel }) {
	const options = vm.preference.modelOptions
	const set = (patch: Partial<typeof options>) => vm.preference.setModelOptions({ ...options, ...patch })
	const ffmpeg = vm.preference.ffmpegOptions
	const maxThreads = Math.max(1, navigator.hardwareConcurrency || 8)
	const isGreedy = options.sampling_strategy === 'greedy'

	return (
		<SettingsGroup title={m.setGroupWhisper()}>
			<SettingsRow label={m.samplingStrategy()} description={m.samplingStrategyInfo()}>
				<Select value={options.sampling_strategy} onValueChange={(value) => set({ sampling_strategy: value as 'greedy' | 'beam search' })}>
					<SelectTrigger className={`w-40 capitalize ${rowControlClass}`}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{['beam search', 'greedy'].map((name) => (
							<SelectItem key={name} value={name} className="capitalize">
								{name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</SettingsRow>

			<SettingsRow label={isGreedy ? m.bestOf() : m.beamSize()} description={isGreedy ? m.greedyInfo() : m.beamInfo()}>
				<NumberField
					aria-label={isGreedy ? m.bestOf() : m.beamSize()}
					value={isGreedy ? (options.best_of ?? 5) : (options.beam_size ?? 5)}
					min={1}
					max={8}
					onChange={(value) => set(isGreedy ? { best_of: value } : { beam_size: value })}
				/>
			</SettingsRow>

			<SettingsRow label={m.temperature()} description={m.infoTemperature()}>
				<NumberField aria-label={m.temperature()} value={options.temperature ?? 0} min={0} max={1} step={0.1} onChange={(value) => set({ temperature: value })} />
			</SettingsRow>

			<SettingsRow label={m.maxTextCtx()} description={m.infoMaxTextCtx()}>
				<NumberField aria-label={m.maxTextCtx()} value={options.max_text_ctx ?? 0} min={0} max={16384} step={64} onChange={(value) => set({ max_text_ctx: value })} />
			</SettingsRow>

			<SettingsRow label={m.maxSentenceLen()} description={m.infoMaxSentenceLen()}>
				<NumberField aria-label={m.maxSentenceLen()} value={options.max_sentence_len ?? 0} min={0} max={512} onChange={(value) => set({ max_sentence_len: value })} />
			</SettingsRow>

			<SettingsRow label={m.threads()} description={m.infoThreads()}>
				<NumberField aria-label={m.threads()} value={options.n_threads ?? 1} min={1} max={maxThreads} onChange={(value) => set({ n_threads: value })} />
			</SettingsRow>

			<SettingsRow label={m.setCustomFfmpeg()} description="ffmpeg -i {input} -ar 16000 -ac 1 -c:a pcm_s16le {custom_command}">
				<Input
					value={ffmpeg.custom_command ?? ''}
					onChange={(event) => vm.preference.setFfmpegOptions({ ...ffmpeg, custom_command: event.target.value || null })}
					placeholder={ffmpeg.normalize_loudness ? '-af loudnorm=I=-16:TP=-1.5:LRA=11' : '-af ...'}
					aria-label={m.setCustomFfmpeg()}
					className={`w-56 font-mono text-xs ${rowControlClass}`}
				/>
			</SettingsRow>

			<ActionRow
				label={m.resetWhisperOptions()}
				icon={<RotateCcw className="h-4 w-4" />}
				activateOnClick
				onClick={() => {
					// The dictionary and the time of every word are set elsewhere, so they stay.
					set({
						...DEFAULT_MODEL_OPTIONS,
						lang: options.lang,
						verbose: options.verbose,
						init_prompt: options.init_prompt,
						word_timestamps: options.word_timestamps,
						translate: false,
					})
					vm.preference.setFfmpegOptions({ ...ffmpeg, custom_command: null })
				}}
			/>
		</SettingsGroup>
	)
}

export function AdvancedSection({ vm }: { vm: SettingsViewModel }) {
	const { fakeUpdate, setFakeUpdate } = useContext(UpdaterContext)
	const cpuVariants: Array<{ value: CpuVariant; label: string }> = [
		{ value: 'auto', label: m.cpuVariantAuto() },
		{ value: 'avx2', label: m.cpuVariantAvx2() },
		{ value: 'baseline', label: m.cpuVariantBaseline() },
	]

	return (
		<div className="space-y-6">
			{/* Dev builds only: flips the update affordances on without waiting for a real release. */}
			{devToolsEnabled && (
				<SettingsGroup title={m.developer()}>
					<SettingsRow label={m.fakeUpdateAvailable()} description={m.fakeUpdateAvailableInfo()}>
						<Switch checked={fakeUpdate} onCheckedChange={setFakeUpdate} />
					</SettingsRow>
				</SettingsGroup>
			)}

			<WhisperGroup vm={vm} />

			<SettingsGroup title={m.setGroupApp()}>
				<SettingsRow label={m.unloadModelAfterInactivity()} description={`${m.unloadModelAfterInactivityInfo()} ${m.zeroMeansNever()}`}>
					<NumberField
						aria-label={m.unloadModelAfterInactivity()}
						value={vm.preference.unloadTimeoutMinutes}
						min={0}
						max={1440}
						step={5}
						suffix={m.minutes()}
						format={(minutes) => (minutes === 0 ? m.never() : undefined)}
						onChange={vm.preference.setUnloadTimeoutMinutes}
					/>
				</SettingsRow>
				<SettingsRow label={m.cpuVariant()} description={m.cpuVariantInfo()}>
					<Select value={vm.preference.cpuVariant} onValueChange={(value: CpuVariant) => vm.preference.setCpuVariant(value)}>
						<SelectTrigger className={`w-44 ${rowControlClass}`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{cpuVariants.map((choice) => (
								<SelectItem key={choice.value} value={choice.value}>
									{choice.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={m.checkYtdlpUpdates()} description={m.ytdlpOptionsInfo()}>
					<Switch checked={vm.preference.shouldCheckYtDlpVersion} onCheckedChange={vm.preference.setShouldCheckYtDlpVersion} />
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup title={m.setGroupBroken()}>
				<ActionRow label={m.copyLogs()} icon={<CopyIcon className="h-4 w-4" />} onClick={vm.copyLogs} />
				<ActionRow label={m.logsFolder()} icon={<FolderIcon className="h-4 w-4" />} onClick={vm.revealLogs} />
				<ActionRow label={m.tempFolder()} icon={<FolderIcon className="h-4 w-4" />} onClick={vm.revealTemp} />
				<ActionRow
					label={m.resetApp()}
					description={m.setResetInfo()}
					icon={<ResetIcon className="h-4 w-4" />}
					onClick={vm.askAndReset}
					destructive
					activateOnClick
				/>
			</SettingsGroup>
		</div>
	)
}
