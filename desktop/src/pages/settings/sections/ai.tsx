import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Copy, ExternalLink, Waypoints } from 'lucide-react'
import { siClaude, siOllama } from 'simple-icons'
import { OPENAI_PATH } from '~/components/brand-glyph'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { ReactComponent as LinkIcon } from '~/icons/link.svg'
import * as config from '~/lib/config'
import { TYTO_BOOSTY_URL, TYTO_BOT_BUY_URL, TYTO_BOT_URL, defaultModel, formatHours, tytoStatus, type AiPlatform, type AiSettings, type TytoStatus } from '~/lib/ai'
import { ClaudeAddressRow, ProxyFields } from '~/lib/tyto/proxy-fields'
import { SegmentedControl } from '~/lib/tyto/segmented-control'
import NumberField from '~/components/number-field'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { ActionRow, IconAction, SettingsGroup, SettingsNote, SettingsRow, rowControlClass, type SettingsViewModel } from './shared'

export type AiTaskId = keyof AiSettings['tasks']

const inlineLinkClass = 'h-6 w-6 rounded-md [&_svg]:size-3.5'

function LabelWithLink({ label, tooltip, onClick }: { label: string; tooltip: string; onClick: () => void }) {
	return (
		<span className="inline-flex items-center gap-1">
			{label}
			<IconAction label={tooltip} icon={<ExternalLink />} onClick={onClick} className={inlineLinkClass} />
		</span>
	)
}

/** Brand marks for the providers, so the picker reads at a glance. */
const platformIcons: Record<Exclude<AiPlatform, 'proxy' | 'tyto'>, { path: string; title: string }> = {
	claude: { path: siClaude.path, title: siClaude.title },
	ollama: { path: siOllama.path, title: siOllama.title },
	openai: { path: OPENAI_PATH, title: 'OpenAI' },
}

/** The owl from the app icon, as the mark for our own service. */
const TYTO_OWL_PATH =
	'M276 214L396 296Q512 336 628 296L748 214L748 620C748 750 640 830 512 830C384 830 276 750 276 620ZM322 448A92 92 0 1 0 506 448A92 92 0 1 0 322 448ZM518 448A92 92 0 1 0 702 448A92 92 0 1 0 518 448ZM480 556L512 612L544 556Z'

function PlatformOption({ platform }: { platform: AiPlatform }) {
	if (platform === 'tyto')
		return (
			<span className="flex items-center gap-2">
				<svg viewBox="262 200 500 680" role="img" aria-hidden className="h-4 w-4 shrink-0">
					<path d={TYTO_OWL_PATH} fill="currentColor" fillRule="evenodd" />
				</svg>
				<span>{m.tytoAiPlatform()}</span>
			</span>
		)
	if (platform === 'proxy')
		return (
			<span className="flex items-center gap-2">
				<Waypoints aria-hidden className="h-4 w-4 shrink-0" />
				<span>{m.aiProxyPlatform()}</span>
			</span>
		)
	const icon = platformIcons[platform]
	return (
		<span className="flex items-center gap-2">
			<svg viewBox="0 0 24 24" role="img" aria-hidden className="h-4 w-4 shrink-0">
				<path d={icon.path} fill="currentColor" />
			</svg>
			<span className="capitalize">{platform === 'openai' ? 'OpenAI Compatible' : platform}</span>
		</span>
	)
}

/** The preset name for a task's row: "Meeting notes", or "Custom prompt" once edited. */
export function presetLabel(preset: string) {
	const labels: Record<string, () => string> = {
		summary: m.presetSummary,
		'meeting-notes': m.presetMeetingNotes,
		tldr: m.presetTldr,
		translate: m.presetTranslate,
		article: m.presetArticle,
		punctuation: m.presetPunctuation,
		formal: m.presetFormal,
		casual: m.presetCasual,
	}
	return labels[preset]?.() ?? m.presetCustom()
}

/** The three answers to «Which AI»: our service, a key of your own (Claude, OpenAI-compatible, proxy), or Ollama. */
type AiKind = 'tyto' | 'own' | 'ollama'
const OWN_PLATFORMS = ['claude', 'openai', 'proxy'] as const

function kindOf(platform: AiPlatform): AiKind {
	return platform === 'tyto' || platform === 'ollama' ? platform : 'own'
}

type StatusState = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; status: TytoStatus } | { state: 'error'; message: string }

/** Hours left on a Tyto AI code: asked when the section opens and again a moment after the code changes. */
function useTytoStatus(code: string) {
	const [result, setResult] = useState<StatusState>({ state: 'idle' })
	const [attempt, setAttempt] = useState(0)
	useEffect(() => {
		const trimmed = code.trim()
		if (!trimmed) {
			setResult({ state: 'idle' })
			return
		}
		let cancelled = false
		setResult({ state: 'loading' })
		const timer = setTimeout(() => {
			tytoStatus(trimmed)
				.then((status) => !cancelled && setResult({ state: 'ok', status }))
				.catch((error: unknown) => !cancelled && setResult({ state: 'error', message: error instanceof Error ? error.message : String(error) }))
		}, 500)
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [code, attempt])
	return { result, refresh: () => setAttempt((n) => n + 1) }
}

function HoursBar({ status }: { status: TytoStatus }) {
	const share = status.limit_s > 0 ? Math.min(100, Math.round((status.left_s / status.limit_s) * 100)) : 0
	return (
		<div
			role="progressbar"
			aria-label={m.tytoAiStatus({ tier: status.tier_name, left: formatHours(status.left_s), limit: formatHours(status.limit_s) })}
			aria-valuenow={share}
			aria-valuemin={0}
			aria-valuemax={100}
			className="h-1.5 w-40 overflow-hidden rounded-full bg-[var(--tyto-row-line)]">
			<div className="h-full rounded-full bg-foreground" style={{ width: `${share}%` }} />
		</div>
	)
}

/** Tyto AI: the code, the hours left with the date they start over, and where to get more. */
function TytoRows({ ai, setAi, result, refresh }: { ai: AiSettings; setAi: (ai: AiSettings) => void; result: StatusState; refresh: () => void }) {
	const { connection, tasks } = ai
	const hasCode = Boolean(connection.tytoCode.trim())

	let statusRow: ReactNode = null
	if (result.state === 'loading') statusRow = <SettingsRow label={m.tytoAiChecking()} />
	if (result.state === 'error')
		statusRow = (
			<SettingsRow label={m.tytoAiCheck()} description={<span className="text-destructive">{result.message}</span>}>
				<Button variant="outline" size="sm" onClick={refresh}>
					{m.tytoAiRefresh()}
				</Button>
			</SettingsRow>
		)
	if (result.state === 'ok') {
		const { status } = result
		statusRow = (
			<SettingsRow
				label={m.tytoAiStatus({ tier: status.tier_name, left: formatHours(status.left_s), limit: formatHours(status.limit_s) })}
				description={status.period_end ? m.tytoAiRenews({ date: new Date(status.period_end * 1000).toLocaleDateString(getLocale(), { day: 'numeric', month: 'long' }) }) : undefined}>
				<HoursBar status={status} />
			</SettingsRow>
		)
	}

	return (
		<>
			<SettingsRow label={m.tytoAiCode()} description={m.tytoAiCodeInfo()}>
				<Input
					aria-label={m.tytoAiCode()}
					value={connection.tytoCode}
					onChange={(e) => {
						const tytoCode = e.target.value.trim().toUpperCase()
						// A pasted code means "I want summaries": switch them on, or nothing visible happens.
						const summary = tytoCode && !connection.tytoCode ? { ...tasks.summary, enabled: true } : tasks.summary
						setAi({ ...ai, connection: { ...connection, tytoCode }, tasks: { ...tasks, summary } })
					}}
					placeholder="TYTO-XXXX-XXXX"
					spellCheck={false}
					className={`w-56 font-mono ${rowControlClass}`}
				/>
			</SettingsRow>
			{hasCode ? (
				<>
					{statusRow}
					<SettingsRow label={m.tytoAiMoreHours()} description={m.tytoAiMoreHoursInfo()}>
						<Button variant="outline" size="sm" onClick={() => openUrl(TYTO_BOT_BUY_URL)}>
							{m.tytoAiPayStars()}
						</Button>
						<Button variant="outline" size="sm" onClick={() => openUrl(TYTO_BOOSTY_URL)}>
							{m.tytoAiPayBoosty()}
						</Button>
					</SettingsRow>
				</>
			) : (
				<SettingsRow label={m.tytoAiNoCodeYet()} description={m.tytoAiTrialInfo()}>
					<Button size="sm" onClick={() => openUrl(TYTO_BOT_URL)}>
						{m.tytoAiGetCode()}
					</Button>
				</SettingsRow>
			)}
		</>
	)
}

/**
 * AI in settings, variant B: «Which AI» first (Tyto AI, own key, Ollama), then what each one does.
 * Tyto AI keeps its hours in view; the other two keep their connection fields, prompts and check.
 */
export function AiSection({ vm, onOpenPrompt }: { vm: SettingsViewModel; onOpenPrompt: (task: AiTaskId) => void }) {
	const { ai, setAi } = vm.preference
	const { connection, tasks } = ai
	const setConnection = (patch: Partial<AiSettings['connection']>) => setAi({ ...ai, connection: { ...connection, ...patch } })
	const setTask = <T extends AiTaskId>(task: T, patch: Partial<AiSettings['tasks'][T]>) =>
		setAi({ ...ai, tasks: { ...tasks, [task]: { ...tasks[task], ...patch } } })
	const test = vm.aiTest
	const kind = kindOf(connection.platform)
	const tyto = kind === 'tyto'
	const choosePlatform = (platform: AiPlatform) => setConnection({ platform, model: defaultModel(platform) })
	const chooseKind = (next: AiKind) => {
		if (next === kind) return
		choosePlatform(next === 'own' ? 'claude' : next)
	}
	// One status request feeds both the hours row and the review row.
	const { result: tytoResult, refresh: refreshTyto } = useTytoStatus(tyto ? connection.tytoCode : '')

	return (
		<div>
			<SettingsGroup title={m.connection()}>
				<SettingsRow label={m.aiWhich()}>
					<SegmentedControl<AiKind>
						ariaLabel={m.aiWhich()}
						value={kind}
						onChange={chooseKind}
						options={[
							{ value: 'tyto', label: m.tytoAiPlatform() },
							{ value: 'own', label: m.aiOwnKey() },
							{ value: 'ollama', label: m.aiOllamaLocal() },
						]}
					/>
				</SettingsRow>

				{tyto && <TytoRows ai={ai} setAi={setAi} result={tytoResult} refresh={refreshTyto} />}

				{kind === 'own' && (
					<SettingsRow label={m.aiService()}>
						<Select value={connection.platform} onValueChange={(platform: AiPlatform) => choosePlatform(platform)}>
							<SelectTrigger aria-label={m.aiService()} className={`w-56 ${rowControlClass}`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{OWN_PLATFORMS.map((name) => (
									<SelectItem key={name} value={name}>
										<PlatformOption platform={name} />
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsRow>
				)}

				{connection.platform === 'claude' && (
					<>
						<ClaudeAddressRow connection={connection} setConnection={setConnection} />
						<SettingsRow
							label={<LabelWithLink label={m.llmApiKey()} tooltip={m.findHere()} onClick={() => openUrl(config.llmApiKeyUrl)} />}
							description={m.infoLlmApiKey()}>
							<Input
								value={connection.claudeApiKey}
								onChange={(e) => setConnection({ claudeApiKey: e.target.value })}
								placeholder={m.pasteApiKey()}
								type="password"
								className={`w-56 ${rowControlClass}`}
							/>
						</SettingsRow>
						<SettingsRow
							label={
								<LabelWithLink
									label={m.llmModel()}
									tooltip={m.findHere()}
									onClick={() => openUrl('https://docs.anthropic.com/en/docs/about-claude/models')}
								/>
							}>
							<Input
								value={connection.model}
								onChange={(e) => setConnection({ model: e.target.value })}
								placeholder={defaultModel('claude')}
								className={`w-56 ${rowControlClass}`}
							/>
						</SettingsRow>
					</>
				)}

				{connection.platform === 'ollama' && (
					<>
						<SettingsRow label={m.ollamaBaseUrl()}>
							<Input
								value={connection.ollamaBaseUrl}
								onChange={(e) => setConnection({ ollamaBaseUrl: e.target.value })}
								className={`w-56 ${rowControlClass}`}
							/>
						</SettingsRow>
						<SettingsRow
							label={
								<LabelWithLink
									label={m.llmModel()}
									tooltip={m.findHere()}
									onClick={() => openUrl(`https://ollama.com/library/${connection.model}`)}
								/>
							}>
							<Input
								value={connection.model}
								onChange={(e) => setConnection({ model: e.target.value })}
								placeholder={defaultModel('ollama')}
								className={`w-56 ${rowControlClass}`}
							/>
						</SettingsRow>
					</>
				)}

				{connection.platform === 'openai' && (
					<>
						<SettingsRow label={m.baseUrl()}>
							<Input
								value={connection.openaiBaseUrl}
								onChange={(e) => setConnection({ openaiBaseUrl: e.target.value })}
								placeholder="https://api.openai.com/v1"
								className={`w-56 ${rowControlClass}`}
							/>
						</SettingsRow>
						<SettingsRow label={m.apiKey()}>
							<Input
								value={connection.openaiApiKey}
								onChange={(e) => setConnection({ openaiApiKey: e.target.value })}
								placeholder={m.optionalLocalServerKey()}
								type="password"
								className={`w-56 ${rowControlClass}`}
							/>
						</SettingsRow>
						<SettingsRow label={m.llmModel()}>
							<Input
								value={connection.model}
								onChange={(e) => setConnection({ model: e.target.value })}
								placeholder={defaultModel('openai')}
								className={`w-56 ${rowControlClass}`}
							/>
						</SettingsRow>
					</>
				)}

				{connection.platform === 'proxy' && <ProxyFields connection={connection} setConnection={setConnection} />}

				{!tyto && (
					<>
						<SettingsRow label={m.contextSize()} description={m.infoContextSize()}>
							<NumberField
								aria-label={m.contextSize()}
								value={connection.contextTokens}
								min={4096}
								max={1_048_576}
								step={4096}
								onChange={(contextTokens) => setConnection({ contextTokens })}
							/>
						</SettingsRow>
						<SettingsNote>
							<span className="italic">{m.contextSizeRuleOfThumb()}</span>
						</SettingsNote>
						<SettingsRow
							label={m.aiTestConnection()}
							description={
								test?.status === 'ok' ? (
									<span className="text-success">{m.aiTestOk({ ms: String(test.ms) })}</span>
								) : test?.status === 'error' ? (
									<span className="text-destructive">{m.checkError()}</span>
								) : (
									m.aiTestInfo()
								)
							}>
							<Button variant="outline" size="sm" onClick={() => void vm.testAi()} disabled={test?.status === 'testing'}>
								{test?.status === 'testing' ? <Spinner className="h-3.5 w-3.5" /> : null}
								{m.runLlmCheck()}
							</Button>
						</SettingsRow>
						{test?.status === 'error' && (
							<div className="relative py-3">
								<button
									type="button"
									className="absolute end-5 top-4 cursor-pointer p-1 text-muted-foreground hover:text-foreground"
									onClick={vm.copyAiError}
									aria-label={m.copy()}>
									{vm.aiErrorCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
								</button>
								<pre className="max-h-40 overflow-y-auto pe-8 text-xs break-all whitespace-pre-wrap text-destructive">{test.error}</pre>
							</div>
						)}
					</>
				)}
			</SettingsGroup>

			<SettingsGroup title={m.aiWhatItDoes()}>
				{tyto ? (
					<>
						<SettingsRow label={m.tytoAiAutoSummary()} description={m.tytoAiAutoSummaryInfo()}>
							<Switch
								aria-label={m.tytoAiAutoSummary()}
								checked={tasks.summary.enabled && tasks.summary.autoOnFinish}
								onCheckedChange={(autoOnFinish) => setTask('summary', { enabled: true, autoOnFinish })}
							/>
						</SettingsRow>
						<SettingsRow label={m.tytoAiReview()} description={m.tytoAiReviewInfo()}>
							{tytoResult.state === 'ok' && (
								<span className="rounded-md bg-muted px-2 py-0.5 text-[12.5px] text-muted-foreground">
									{tytoResult.status.review ? m.tytoAiInLevel() : m.tytoAiReviewLevels()}
								</span>
							)}
						</SettingsRow>
						<SettingsRow label={<span className="text-muted-foreground">{m.tytoAiOwnOnly()}</span>} description={m.tytoAiOwnOnlyInfo()} />
					</>
				) : (
					<>
						<SettingsRow label={m.aiSummaryTask()} description={presetLabel(tasks.summary.preset)}>
							<Button variant="outline" size="sm" onClick={() => onOpenPrompt('summary')}>
								{m.aiEditPrompt()}
							</Button>
							<Switch checked={tasks.summary.enabled} onCheckedChange={(enabled) => setTask('summary', { enabled })} />
						</SettingsRow>
						{tasks.summary.enabled && (
							<SettingsRow label={m.autoSummarizeOnFinish()} description={m.autoSummarizeOnFinishInfo()}>
								<Switch checked={tasks.summary.autoOnFinish} onCheckedChange={(autoOnFinish) => setTask('summary', { autoOnFinish })} />
							</SettingsRow>
						)}
						<SettingsRow label={m.aiDictationTask()} description={presetLabel(tasks.dictation.preset)}>
							<Button variant="outline" size="sm" onClick={() => onOpenPrompt('dictation')}>
								{m.aiEditPrompt()}
							</Button>
							<Switch checked={tasks.dictation.enabled} onCheckedChange={(enabled) => setTask('dictation', { enabled })} />
						</SettingsRow>
					</>
				)}
			</SettingsGroup>

			{connection.platform === 'claude' && (
				<SettingsGroup title={m.settingsUsageAndBilling()}>
					<ActionRow label={m.setMonthlySpendLimit()} icon={<LinkIcon className="h-4 w-4" />} onClick={() => openUrl(config.llmLimitsUrl)} />
					<ActionRow label={m.llmCurrentCost()} icon={<LinkIcon className="h-4 w-4" />} onClick={() => openUrl(config.llmCostUrl)} />
				</SettingsGroup>
			)}
		</div>
	)
}

/** A row for another section that points into the AI page: state on the right, arrow to go. */
export function AiTaskLink({ label, enabled, onClick }: { label: string; enabled: boolean; onClick: () => void }) {
	return (
		<ActionRow
			label={label}
			description={enabled ? m.on() : m.off()}
			icon={<ChevronRight className="h-4 w-4 rtl:rotate-180" />}
			onClick={onClick}
			activateOnClick
		/>
	)
}
