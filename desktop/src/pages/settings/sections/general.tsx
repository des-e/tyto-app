import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLink, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { m } from '~/paraglide/messages.js'
import * as config from '~/lib/config'
import { TYTO_BOOSTY_URL, TYTO_CHANNEL_URL } from '~/lib/ai'
import { DisplayLanguageInput } from '~/components/display-language-input'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { SegmentedControl } from '~/lib/tyto/segmented-control'
import { ActionRow, SettingsGroup, SettingsRow, type SettingsViewModel } from './shared'

/**
 * The OS owns this setting, not our config: the user can remove the login item from
 * system settings and a reinstall can clear it. So we read the real state on mount and
 * re-read it after every write instead of persisting a key that would drift.
 */
function LaunchAtStartupSwitch() {
	const [enabled, setEnabled] = useState(false)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		let cancelled = false
		isEnabled()
			.then((value) => {
				if (!cancelled) {
					setEnabled(value)
				}
			})
			.catch((error) => {
				console.error('failed to read autostart state', error)
			})
		return () => {
			cancelled = true
		}
	}, [])

	async function onCheckedChange(next: boolean) {
		setBusy(true)
		try {
			if (next) {
				await enable()
			} else {
				await disable()
			}
		} catch (error) {
			const message = next ? m.couldNotEnableLaunchAtStartup : m.couldNotDisableLaunchAtStartup
			toast.error(message({ error: String(error) }))
		}
		try {
			setEnabled(await isEnabled())
		} catch (error) {
			console.error('failed to read autostart state', error)
		}
		setBusy(false)
	}

	return <Switch checked={enabled} disabled={busy} onCheckedChange={onCheckedChange} />
}

export function GeneralSection({ vm }: { vm: SettingsViewModel }) {
	const themeLabels = { light: m.light, dark: m.dark } as const
	const themeIcons = { light: Sun, dark: Moon } as const

	return (
		<div className="space-y-5">
			<SettingsGroup>
				<SettingsRow label={m.displayLanguage()}>
					<DisplayLanguageInput value={vm.preference.displayLanguage} onSelect={vm.preference.setDisplayLanguage} className="w-52" />
				</SettingsRow>
				<SettingsRow label={m.theme()}>
					<SegmentedControl
						ariaLabel={m.theme()}
						value={vm.preference.theme as 'light' | 'dark'}
						onChange={vm.preference.setTheme}
						options={config.themes.map((theme) => {
							const Icon = themeIcons[theme as keyof typeof themeIcons]
							return {
								value: theme as 'light' | 'dark',
								label: themeLabels[theme as keyof typeof themeLabels](),
								icon: Icon && <Icon className="h-3.5 w-3.5" />,
							}
						})}
					/>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup title={m.generalBehavior()}>
				<SettingsRow label={m.closeToTray()} description={m.generalTrayInfo()}>
					<Switch checked={vm.preference.closeToTray} onCheckedChange={vm.preference.setCloseToTray} />
				</SettingsRow>
				<SettingsRow label={m.launchAtStartup()} description={m.launchAtStartupInfo()}>
					<LaunchAtStartupSwitch />
				</SettingsRow>
				<SettingsRow label={m.preventSleep()} description={m.generalAwakeInfo()}>
					<Switch checked={vm.preference.preventSleep} onCheckedChange={vm.preference.setPreventSleep} />
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup title={m.tytoSupport()}>
				<ActionRow
					label={m.tytoSupportBoosty()}
					description={m.tytoSupportBoostyInfo()}
					icon={<ExternalLink className="h-4 w-4" />}
					onClick={() => openUrl(TYTO_BOOSTY_URL)}
				/>
				<ActionRow
					label={m.tytoSupportTelegram()}
					description={m.tytoSupportTelegramInfo()}
					icon={<ExternalLink className="h-4 w-4" />}
					onClick={() => openUrl(TYTO_CHANNEL_URL)}
				/>
			</SettingsGroup>

			<div className="mt-6 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
				<Button variant="ghost" size="sm" className="ml-auto" onClick={() => openUrl(config.aboutURL)}>
					{m.projectLink()}
				</Button>
				<Button variant="ghost" size="sm" className="-mr-3" onClick={vm.reportIssue}>
					{m.reportIssue()}
				</Button>
			</div>
		</div>
	)
}
