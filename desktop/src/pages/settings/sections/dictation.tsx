import { useEffect, useState } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import { m } from '~/paraglide/messages.js'
import ShortcutRecorder from '~/components/shortcut-recorder'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { SegmentedControl } from '~/lib/tyto/segmented-control'
import { getDefaultHotkeyShortcut, useHotkeyProvider, type HotkeyActivationMode, type HotkeyOutputMode } from '~/providers/hotkey'
import { getDictationIndicatorEnabled, setDictationIndicatorEnabled } from '~/lib/dictation-indicator'
import { SettingsGroup, SettingsNote, SettingsRow, type SettingsViewModel } from './shared'

/** «Диктовка» (design round 8): turning it on, then what happens to the text. */
export function DictationSection({ vm, onOpenCleanup }: { vm: SettingsViewModel; onOpenCleanup: () => void }) {
	const hotkey = useHotkeyProvider()
	const [indicatorEnabled, setIndicatorEnabled] = useState(true)
	useEffect(() => {
		getDictationIndicatorEnabled().then(setIndicatorEnabled).catch(console.error)
	}, [])
	async function changeIndicatorEnabled(enabled: boolean) {
		setIndicatorEnabled(enabled)
		try {
			await setDictationIndicatorEnabled(enabled)
		} catch (error) {
			setIndicatorEnabled(!enabled)
			console.error(error)
		}
	}

	const ai = vm.preference.ai
	const cleanup = ai.tasks.dictation.enabled
	const setCleanup = (enabled: boolean) => vm.preference.setAi({ ...ai, tasks: { ...ai.tasks, dictation: { ...ai.tasks.dictation, enabled } } })
	const pasteKeys = platform() === 'macos' ? '⌘V' : 'Ctrl+V'

	const activationOptions: { value: HotkeyActivationMode; label: string }[] = [
		{ value: 'push-to-talk', label: m.setHold() },
		{ value: 'toggle', label: m.setPress() },
	]
	const activationDescriptions = {
		'push-to-talk': m.hotkeyActivationPushToTalkDescription,
		toggle: m.hotkeyActivationToggleDescription,
	} as const
	const outputOptions: { value: HotkeyOutputMode; label: string }[] = [
		{ value: 'type', label: m.setTypeIn() },
		{ value: 'clipboard', label: m.setCopy() },
	]

	return (
		<div className="space-y-6">
			<SettingsGroup title={m.setGroupEnable()}>
				<SettingsRow label={m.setDictationHotkey()} description={m.setDictationHotkeyInfo()}>
					<Switch checked={hotkey.hotkeyEnabled} onCheckedChange={hotkey.setHotkeyEnabled} aria-label={m.setDictationHotkey()} />
				</SettingsRow>

				{hotkey.hotkeyEnabled && (
					<>
						<SettingsRow label={m.setShortcut()}>
							<ShortcutRecorder
								value={hotkey.hotkeyShortcut}
								onChange={hotkey.setHotkeyShortcut}
								defaultValue={getDefaultHotkeyShortcut()}
								onCapturingChange={hotkey.setHotkeyCapturing}
							/>
						</SettingsRow>
						{hotkey.hotkeyShortcutError && (
							<SettingsNote>
								<span role="alert" className="text-destructive">
									{m.shortcutRegistrationFailed({ error: hotkey.hotkeyShortcutError })}
								</span>
							</SettingsNote>
						)}
						<SettingsRow label={m.setHowToStart()} description={activationDescriptions[hotkey.hotkeyActivationMode]()}>
							<SegmentedControl
								ariaLabel={m.setHowToStart()}
								value={hotkey.hotkeyActivationMode}
								options={activationOptions}
								onChange={hotkey.setHotkeyActivationMode}
							/>
						</SettingsRow>
					</>
				)}
			</SettingsGroup>

			{hotkey.hotkeyEnabled && (
				<SettingsGroup title={m.setGroupText()}>
					<SettingsRow label={m.setWhereText()} description={m.setWhereTextInfo({ keys: pasteKeys })}>
						<SegmentedControl ariaLabel={m.setWhereText()} value={hotkey.hotkeyOutputMode} options={outputOptions} onChange={hotkey.setHotkeyOutputMode} />
					</SettingsRow>
					<SettingsRow label={m.setOneLine()} description={m.setOneLineInfo()}>
						<Switch checked={hotkey.hotkeyNormalizeOutput} onCheckedChange={hotkey.setHotkeyNormalizeOutput} aria-label={m.setOneLine()} />
					</SettingsRow>
					<SettingsRow label={m.setAiCleanup()} description={m.setAiCleanupInfo()}>
						{cleanup && (
							<Button variant="ghost" size="sm" onClick={onOpenCleanup}>
								{m.setConfigure()}
							</Button>
						)}
						<Switch checked={cleanup} onCheckedChange={setCleanup} aria-label={m.setAiCleanup()} />
					</SettingsRow>
					<SettingsRow label={m.setIndicator()} description={m.setIndicatorInfo()}>
						<Switch checked={indicatorEnabled} onCheckedChange={changeIndicatorEnabled} aria-label={m.setIndicator()} />
					</SettingsRow>
				</SettingsGroup>
			)}
		</div>
	)
}
