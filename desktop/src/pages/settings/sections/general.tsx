import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLink, Monitor, Moon, Sun } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { m } from '~/paraglide/messages.js'
import * as config from '~/lib/config'
import { TYTO_BOOSTY_URL, TYTO_CHANNEL_URL } from '~/lib/ai'
import { DisplayLanguageInput } from '~/components/display-language-input'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { SegmentedControl } from '~/lib/tyto/segmented-control'
import type { ThemeChoice } from '~/lib/tyto/theme-choice'
import { UpdaterContext } from '~/providers/updater'
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

	return <Switch checked={enabled} disabled={busy} onCheckedChange={onCheckedChange} aria-label={m.genStartup()} />
}

/** «Проверить обновления»: asks now, says what it found, and opens the update window when there is one. */
function CheckUpdatesButton({ onStatus }: { onStatus: (status: string | null) => void }) {
	const { checkNow, updateApp } = useContext(UpdaterContext)
	const [checking, setChecking] = useState(false)

	async function check() {
		setChecking(true)
		onStatus(null)
		const result = await checkNow()
		setChecking(false)
		if (result === 'found') {
			onStatus(m.genUpdateFound())
			void updateApp()
		} else {
			onStatus(result === 'none' ? m.genUpToDate() : m.genCheckFailed())
		}
	}

	return (
		<Button variant="outline" size="sm" disabled={checking} onClick={() => void check()}>
			{checking ? m.genChecking() : m.genCheckUpdates()}
		</Button>
	)
}

/** «Общие» (design round 8, accepted): appearance, the background, about Tyto, and support. */
export function GeneralSection({ vm }: { vm: SettingsViewModel }) {
	const [updateStatus, setUpdateStatus] = useState<string | null>(null)
	const themeOptions: { value: ThemeChoice; label: string; icon?: React.ReactNode }[] = [
		{ value: 'light', label: m.light(), icon: <Sun className="h-3.5 w-3.5" /> },
		{ value: 'dark', label: m.dark(), icon: <Moon className="h-3.5 w-3.5" /> },
		{ value: 'system', label: m.genThemeSystem(), icon: <Monitor className="h-3.5 w-3.5" /> },
	]

	return (
		<div className="space-y-6">
			<SettingsGroup title={m.genAppearance()}>
				<SettingsRow label={m.displayLanguage()}>
					<DisplayLanguageInput value={vm.preference.displayLanguage} onSelect={vm.preference.setDisplayLanguage} className="w-52" />
				</SettingsRow>
				<SettingsRow label={m.theme()}>
					<SegmentedControl ariaLabel={m.theme()} value={vm.preference.themeChoice} onChange={vm.preference.setTheme} options={themeOptions} />
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup title={m.genBackground()}>
				<SettingsRow label={m.genTray()} description={m.genTrayInfo()}>
					<Switch checked={vm.preference.closeToTray} onCheckedChange={vm.preference.setCloseToTray} aria-label={m.genTray()} />
				</SettingsRow>
				<SettingsRow label={m.genStartup()} description={m.genStartupInfo()}>
					<LaunchAtStartupSwitch />
				</SettingsRow>
				<SettingsRow label={m.preventSleep()} description={m.generalAwakeInfo()}>
					<Switch checked={vm.preference.preventSleep} onCheckedChange={vm.preference.setPreventSleep} aria-label={m.preventSleep()} />
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup title={m.genAbout()}>
				<SettingsRow label={m.genVersion({ version: vm.appVersionNumber || '…' })} description={updateStatus ?? m.genUpdatesAuto()}>
					<CheckUpdatesButton onStatus={setUpdateStatus} />
				</SettingsRow>
				<SettingsRow label={m.reportIssue()} description={m.genReportInfo()}>
					<Button variant="outline" size="sm" onClick={vm.reportIssue}>
						{m.genOpen()}
					</Button>
				</SettingsRow>
				<ActionRow label={m.genProject()} description={m.genProjectInfo()} icon={<ExternalLink className="h-4 w-4" />} onClick={() => openUrl(config.aboutURL)} />
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
		</div>
	)
}
