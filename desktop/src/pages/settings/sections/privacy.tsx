import { openUrl } from '@tauri-apps/plugin-opener'
import { m } from '~/paraglide/messages.js'
import * as config from '~/lib/config'
import { FEATURES } from '~/lib/tyto/features'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { SettingsGroup, SettingsRow, type SettingsViewModel } from './shared'

/** «Конфиденциальность» (design round 8, accepted): where recordings live, and what leaves the computer. */
export function PrivacySection({ vm }: { vm: SettingsViewModel }) {
	const projectsPath = vm.preference.projectsPath ?? vm.defaultProjectsPath

	return (
		<div className="space-y-6">
			<SettingsGroup title={m.privRecords()}>
				<SettingsRow
					label={m.privWhere()}
					description={
						<span title={projectsPath} className="block truncate font-mono">
							{projectsPath}
						</span>
					}>
					{vm.preference.projectsPath && (
						<Button variant="ghost" size="sm" onMouseDown={vm.resetProjectsPath}>
							{m.resetToDefault()}
						</Button>
					)}
					<Button variant="outline" size="sm" onMouseDown={vm.changeProjectsPath}>
						{m.privChangeFolder()}
					</Button>
				</SettingsRow>
				<SettingsRow label={m.privSave()} description={m.privSaveInfo()}>
					<Switch checked={vm.preference.saveTranscripts} onCheckedChange={vm.preference.setSaveTranscripts} aria-label={m.privSave()} />
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup title={m.privOnline()}>
				<SettingsRow label={m.privTranscription()} description={m.privTranscriptionInfo()} />
				<SettingsRow label={m.privAi()} description={m.privAiInfo()} />
				{FEATURES.analytics && (
					<SettingsRow label={m.analyticsEnabled()} description={!vm.preference.analyticsEnabled ? m.analyticsDisabledWarning() : undefined}>
						<Switch checked={vm.preference.analyticsEnabled} onCheckedChange={vm.preference.setAnalyticsEnabled} />
					</SettingsRow>
				)}
			</SettingsGroup>

			<SettingsGroup>
				<SettingsRow label={m.privPolicy()}>
					<Button variant="outline" size="sm" onClick={() => void openUrl(config.privacyPolicyURL)}>
						{m.genOpen()}
					</Button>
				</SettingsRow>
			</SettingsGroup>
		</div>
	)
}
