import { message } from '@tauri-apps/plugin-dialog'
import { DEFAULT_MODEL_OPTIONS } from '~/providers/preference'
import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { SettingsGroup, SettingsRow, type SettingsViewModel } from './shared'

/** «Тонкая настройка» (design round 8): accuracy and sound; Whisper and FFmpeg live in «Для опытных». */
export function TuningSection({ vm, onOpenAdvanced }: { vm: SettingsViewModel; onOpenAdvanced: () => void }) {
	const options = vm.preference.modelOptions
	const ffmpeg = vm.preference.ffmpegOptions
	const customized =
		Boolean(ffmpeg.custom_command) ||
		(Object.keys(DEFAULT_MODEL_OPTIONS) as (keyof typeof DEFAULT_MODEL_OPTIONS)[])
			.filter((key) => !['lang', 'verbose', 'init_prompt', 'word_timestamps', 'translate'].includes(key))
			.some((key) => (options[key] ?? DEFAULT_MODEL_OPTIONS[key]) !== DEFAULT_MODEL_OPTIONS[key])

	return (
		<div className="space-y-6">
			<SettingsGroup title={m.setGroupAccuracy()}>
				<SettingsRow label={m.setStable()} description={m.setStableInfo()}>
					<Switch checked={vm.preference.stableTimestampsEnabled} onCheckedChange={vm.handleStableTimestampsToggle} aria-label={m.setStable()} />
				</SettingsRow>
				<SettingsRow label={m.setWordTimes()} description={m.setWordTimesInfo()}>
					<Switch
						checked={Boolean(options.word_timestamps)}
						aria-label={m.setWordTimes()}
						onCheckedChange={(checked) => {
							// The switch does nothing without a sentence length, so say so rather than letting it look broken.
							if (checked && !options.max_sentence_len) void message(m.pleaseSetMaxSentenceLen())
							vm.preference.setModelOptions({ ...options, word_timestamps: checked })
						}}
					/>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup title={m.setGroupSound()}>
				<SettingsRow label={m.setNormalize()} description={m.setNormalizeInfo()}>
					<Switch
						checked={ffmpeg.normalize_loudness}
						aria-label={m.setNormalize()}
						onCheckedChange={(checked) => vm.preference.setFfmpegOptions({ ...ffmpeg, normalize_loudness: checked })}
					/>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup>
				<SettingsRow
					label={
						<span className="flex items-center gap-2">
							{m.setWhisperLink()}
							{customized && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{m.tuningCustomized()}</span>}
						</span>
					}
					description={m.setWhisperLinkInfo()}>
					<Button variant="outline" size="sm" onClick={onOpenAdvanced}>
						{m.setOpenAdvanced()}
					</Button>
				</SettingsRow>
			</SettingsGroup>
		</div>
	)
}
