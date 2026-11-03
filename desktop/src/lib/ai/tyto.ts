import { fetch } from '@tauri-apps/plugin-http'
import { m } from '~/paraglide/messages.js'
import type { Segment } from '~/lib/transcript'

/**
 * Tyto AI: our own server (tyto-ai) with an access code from the Telegram bot. It writes the summary
 * and topics, and the AI review on the levels that have it, and counts hours of recording.
 */
export const TYTO_AI_URL = 'https://eliseevdenis.ru/tyto-ai'
export const TYTO_BOT_URL = 'https://t.me/Tytotranscribe_bot'
export const TYTO_BOOSTY_URL = 'https://boosty.to/tytoapp'

export interface TytoStatus {
	tier: string
	tier_name: string
	limit_s: number
	used_s: number
	left_s: number
	review: boolean
	/** Unix seconds when the hours start over; null for codes without a monthly reset. */
	period_end: number | null
}

export interface TytoTopic {
	start: string
	title: string
}

/** The server's message is written for people (in Russian), so it is shown as is. */
export class TytoError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message)
	}
}

export function normalizeCode(code: string) {
	return code.trim().toUpperCase()
}

/** «00:12:30 text» per segment: the server reads the length and the topic times from these stamps. */
export function tytoTranscript(segments: Segment[], speakerName?: (speaker: number) => string) {
	return segments
		.filter((segment) => segment.text.trim())
		.map((segment) => {
			const seconds = Math.floor(segment.start / 100)
			const stamp = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((n) => String(n).padStart(2, '0')).join(':')
			const who = segment.speaker != null && speakerName ? `${speakerName(segment.speaker)}: ` : ''
			return `${stamp} ${who}${segment.text.trim()}`
		})
		.join('\n')
}

export function recordingSeconds(segments: Segment[]) {
	return Math.ceil(Math.max(0, ...segments.map((segment) => segment.stop)) / 100)
}

async function call<T>(path: string, code: string, body?: unknown): Promise<T> {
	let response: Response
	try {
		response = await fetch(`${TYTO_AI_URL}${path}`, {
			method: body === undefined ? 'GET' : 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Tyto-Code': normalizeCode(code) },
			body: body === undefined ? undefined : JSON.stringify(body),
		})
	} catch (error) {
		throw new TytoError(m.tytoAiOffline({ error: error instanceof Error ? error.message : String(error) }), 0)
	}
	const text = await response.text()
	let data: unknown = null
	try {
		data = JSON.parse(text)
	} catch {
		// not JSON: a proxy error page
	}
	if (!response.ok) {
		const detail = (data as { detail?: unknown } | null)?.detail
		throw new TytoError(typeof detail === 'string' ? detail : `${m.tytoAiPlatform()}: ${response.status}`, response.status)
	}
	return data as T
}

export function tytoStatus(code: string) {
	return call<TytoStatus>('/v1/status', code)
}

export function tytoSummary(code: string, transcript: string, durationS: number) {
	return call<{ summary: string; topics: TytoTopic[]; status: TytoStatus }>('/v1/summary', code, { transcript, duration_s: durationS })
}

export function tytoReview(code: string, transcript: string, durationS: number) {
	return call<{ markdown: string; status: TytoStatus }>('/v1/review', code, { transcript, duration_s: durationS })
}

/** The saved summary is markdown: the text, then the topics with their times. */
export function summaryMarkdown(summary: string, topics: TytoTopic[], topicsTitle: string) {
	const list = topics.map((topic) => `- **${topic.start}** ${topic.title}`).join('\n')
	return list ? `${summary.trim()}\n\n### ${topicsTitle}\n\n${list}` : summary.trim()
}

export function formatHours(seconds: number) {
	const total = Math.max(0, Math.floor(seconds))
	const h = Math.floor(total / 3600)
	const min = Math.floor((total % 3600) / 60)
	if (h && min) return m.tytoAiHoursMinutes({ h: String(h), min: String(min) })
	return h ? m.tytoAiHours({ h: String(h) }) : m.tytoAiMinutes({ min: String(min) })
}
