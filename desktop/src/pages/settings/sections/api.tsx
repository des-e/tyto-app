import { openUrl } from '@tauri-apps/plugin-opener'
import { FileJson } from 'lucide-react'
import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { ClaudeCodeMark, CodexMark } from '~/components/agent-marks'
import { ActionRow, SettingsGroup, SettingsRow, type SettingsViewModel } from './shared'

/** «Агенты» (design round 8): the local API behind one switch, then teaching an agent to use it. */
export function ApiSection({ vm }: { vm: SettingsViewModel }) {
	const apiDocsUrl = vm.apiBaseUrl ? `${vm.apiBaseUrl}/docs` : null
	const busy = vm.isStartingApiServer || vm.isStoppingApiServer
	const address = vm.isStartingApiServer ? m.apiStarting() : vm.isStoppingApiServer ? m.apiStopping() : vm.apiBaseUrl
	// Installing embeds what the running server serves, so it needs the server; so does copying.
	const ready = Boolean(vm.apiBaseUrl)

	return (
		<div className="space-y-6">
			<SettingsGroup title={m.setGroupAccess()}>
				<SettingsRow label={m.setAllowApps()} description={m.setAllowAppsInfo()}>
					<Switch
						checked={ready}
						disabled={busy}
						aria-label={m.setAllowApps()}
						onCheckedChange={(checked) => (checked ? vm.startApiServer() : vm.stopApiServer())}
					/>
				</SettingsRow>
				{address && (
					<SettingsRow label={m.setAddress()} description={m.setAddressInfo()}>
						<code className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground select-all">{address}</code>
						{apiDocsUrl && (
							<Button variant="ghost" size="sm" onClick={() => void openUrl(apiDocsUrl)}>
								{m.setApiDocs()}
							</Button>
						)}
					</SettingsRow>
				)}
			</SettingsGroup>

			<SettingsGroup title={m.setTeachAgent()}>
				<SettingsRow
					label={
						<span className="flex items-center gap-2">
							<ClaudeCodeMark />
							Claude Code
						</span>
					}
					description={m.setClaudeInfo()}>
					<Button variant="outline" size="sm" disabled={!ready} onClick={() => vm.installAgentSkill('claude')}>
						{m.setInstall()}
					</Button>
				</SettingsRow>
				<SettingsRow
					label={
						<span className="flex items-center gap-2">
							<CodexMark />
							Codex
						</span>
					}
					description={m.setCodexInfo()}>
					<Button variant="outline" size="sm" disabled={!ready} onClick={() => vm.installAgentSkill('codex')}>
						{m.setInstall()}
					</Button>
				</SettingsRow>
				<SettingsRow label={m.setOtherAgent()} description={m.setOtherAgentInfo()}>
					<Button variant="outline" size="sm" disabled={!ready} onClick={vm.copyAgentSkill}>
						{m.setCopyInstruction()}
					</Button>
				</SettingsRow>
				<SettingsRow label={m.setExample()} description={<span className="italic">{m.setExampleText()}</span>} />
			</SettingsGroup>

			{/* The settings file is the other half of the agent story: it works whether or not the API runs. */}
			<SettingsGroup>
				<ActionRow label={m.configFile()} icon={<FileJson className="h-4 w-4" />} onClick={vm.revealConfigFile} />
			</SettingsGroup>
		</div>
	)
}
