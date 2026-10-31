import { m } from '~/paraglide/messages.js'
import { CLAUDE_BASE_URL, defaultModel, type AiConnection } from '~/lib/ai'
import { Input } from '~/components/ui/input'
import { SettingsNote, SettingsRow, rowControlClass } from '~/pages/settings/sections/shared'
import { detectProxyFormat, isInsecureRemote, type ProxyFormat } from './proxy-format'
import { SegmentedControl } from './segmented-control'

type SetConnection = (patch: Partial<AiConnection>) => void

const otherFormat = (format: ProxyFormat): ProxyFormat => (format === 'openai' ? 'claude' : 'openai')

/** A new format, and no stale model: the other format's example model is cleared rather than sent. */
function formatChange(connection: AiConnection, format: ProxyFormat): Partial<AiConnection> {
	const stale = connection.model === defaultModel(otherFormat(format))
	return stale ? { proxyFormat: format, model: '' } : { proxyFormat: format }
}

/**
 * Typing the address sets the format, until the person picks one by hand. Clearing the address
 * forgets that choice, so the next pasted address is read afresh.
 */
export function proxyAddressPatch(connection: AiConnection, proxyBaseUrl: string): Partial<AiConnection> {
	if (!proxyBaseUrl.trim()) return { proxyBaseUrl, proxyFormatManual: false }
	if (connection.proxyFormatManual) return { proxyBaseUrl }
	return { proxyBaseUrl, ...formatChange(connection, detectProxyFormat(proxyBaseUrl)) }
}

export function proxyFormatPatch(connection: AiConnection, format: ProxyFormat): Partial<AiConnection> {
	return { ...formatChange(connection, format), proxyFormatManual: true }
}

function InsecureNote({ url }: { url: string }) {
	return isInsecureRemote(url) ? (
		<SettingsNote>
			<span className="text-destructive">{m.aiInsecureAddress()}</span>
		</SettingsNote>
	) : null
}

/** «Адрес API» for the Claude platform; empty means the official address. */
export function ClaudeAddressRow({ connection, setConnection }: { connection: AiConnection; setConnection: SetConnection }) {
	return (
		<>
			<SettingsRow label={m.aiApiAddress()}>
				<Input
					aria-label={m.aiApiAddress()}
					value={connection.claudeBaseUrl}
					onChange={(e) => setConnection({ claudeBaseUrl: e.target.value })}
					placeholder={CLAUDE_BASE_URL}
					className={`w-64 ${rowControlClass}`}
				/>
			</SettingsRow>
			<InsecureNote url={connection.claudeBaseUrl} />
		</>
	)
}

/** The «Через прокси-сервис» platform: address, key, request format and model. */
export function ProxyFields({ connection, setConnection }: { connection: AiConnection; setConnection: SetConnection }) {
	return (
		<>
			<SettingsRow label={m.aiApiAddress()} description={m.aiProxyHint()}>
				<Input
					aria-label={m.aiApiAddress()}
					value={connection.proxyBaseUrl}
					onChange={(e) => setConnection(proxyAddressPatch(connection, e.target.value))}
					placeholder="https://.../v1"
					className={`w-64 ${rowControlClass}`}
				/>
			</SettingsRow>
			<InsecureNote url={connection.proxyBaseUrl} />
			<SettingsRow label={m.aiProxyKey()}>
				<Input
					aria-label={m.aiProxyKey()}
					value={connection.proxyApiKey}
					onChange={(e) => setConnection({ proxyApiKey: e.target.value })}
					placeholder={m.pasteApiKey()}
					type="password"
					className={`w-64 ${rowControlClass}`}
				/>
			</SettingsRow>
			<SettingsRow label={m.aiProxyFormat()}>
				<SegmentedControl<ProxyFormat>
					ariaLabel={m.aiProxyFormat()}
					value={connection.proxyFormat}
					onChange={(format) => setConnection(proxyFormatPatch(connection, format))}
					options={[
						{ value: 'openai', label: 'OpenAI' },
						{ value: 'claude', label: 'Claude' },
					]}
				/>
			</SettingsRow>
			<SettingsRow label={m.llmModel()}>
				<Input
					aria-label={m.llmModel()}
					value={connection.model}
					onChange={(e) => setConnection({ model: e.target.value })}
					placeholder={defaultModel(connection.proxyFormat)}
					className={`w-64 ${rowControlClass}`}
				/>
			</SettingsRow>
		</>
	)
}
