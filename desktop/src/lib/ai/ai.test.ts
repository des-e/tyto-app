import { afterEach, describe, expect, it, vi } from 'vitest'
import { m } from '~/paraglide/messages.js'
import { DEFAULT_AI, migrateLegacy, modernizePrompt, normalizeAi, presetPrompt } from './config'
import { chunkLines, createClient, fillPrompt, inputBudgetBytes, testConnection } from './client'
import { recordingSeconds, splitSummary, stampSeconds, summaryMarkdown, tytoTranscript } from './tyto'

const fetchMock = vi.fn()
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }))

afterEach(() => fetchMock.mockReset())

describe('migrateLegacy', () => {
	it('returns the defaults with nothing to migrate', () => {
		expect(migrateLegacy(null)).toEqual(DEFAULT_AI)
		expect(migrateLegacy(undefined)).toEqual(DEFAULT_AI)
	})

	it('moves the old prompt to the summary task and gives dictation its own', () => {
		const migrated = migrateLegacy(
			{ platform: 'ollama', enabled: true, model: 'llama3', prompt: 'Summarize: %s', ollamaBaseUrl: 'http://box:11434', contextTokens: 8192 } as never,
			true,
		)
		expect(migrated.connection).toMatchObject({ platform: 'ollama', model: 'llama3', ollamaBaseUrl: 'http://box:11434', contextTokens: 8192 })
		expect(migrated.tasks.summary).toEqual({ enabled: true, autoOnFinish: true, preset: 'custom', prompt: 'Summarize: {transcript}' })
		expect(migrated.tasks.dictation).toEqual({ enabled: true, preset: 'punctuation', prompt: presetPrompt('punctuation') })
	})

	it('keeps the summary off when it was off', () => {
		const migrated = migrateLegacy({ platform: 'claude', enabled: false, prompt: '' } as never, true)
		expect(migrated.tasks.summary.enabled).toBe(false)
		expect(migrated.tasks.summary.autoOnFinish).toBe(false)
		expect(migrated.tasks.summary.preset).toBe('summary')
	})

	it('modernizes only the placeholder', () => {
		expect(modernizePrompt('a %s b', 'dictation')).toBe('a {text} b')
	})
})

describe('fillPrompt', () => {
	it('fills every placeholder, and %s for old prompts', () => {
		expect(fillPrompt('{language}: {transcript} / {speakers}', { transcript: 'hi', language: 'Hebrew', speakers: 'A, B' })).toBe('Hebrew: hi / A, B')
		expect(fillPrompt('old %s', { text: 'hi' })).toBe('old hi')
		expect(fillPrompt('{text}', { transcript: 'hi' })).toBe('hi')
	})
})

describe('chunkLines', () => {
	it('keeps one chunk when it fits, splits between lines when it does not', () => {
		const lines = ['one', 'two', 'three']
		expect(chunkLines(lines, '{transcript}', 4096)).toEqual(['one\ntwo\nthree'])
		const long = Array.from({ length: 200 }, (_, index) => `line ${index} ${'x'.repeat(100)}`)
		const chunks = chunkLines(long, '{transcript}', 4096)
		expect(chunks.length).toBeGreaterThan(1)
		expect(chunks.join('\n')).toBe(long.join('\n'))
		const budget = inputBudgetBytes(4096)
		for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(budget)
	})
})

function streamResponse(lines: string[]) {
	const encoder = new TextEncoder()
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const line of lines) controller.enqueue(encoder.encode(line + '\n'))
			controller.close()
		},
	})
	return { ok: true, status: 200, statusText: 'OK', body, text: async () => lines.join('\n'), json: async () => ({}) }
}

describe('createClient', () => {
	it('streams Ollama NDJSON', async () => {
		fetchMock.mockResolvedValue(streamResponse(['{"response":"Hel"}', '{"response":"lo"}', '{"done":true}']))
		const tokens: string[] = []
		const text = await createClient({ ...DEFAULT_AI.connection, platform: 'ollama' }).stream('p', (token) => tokens.push(token))
		expect(text).toBe('Hello')
		expect(tokens).toEqual(['Hel', 'lo'])
		expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/generate')
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ stream: true, model: DEFAULT_AI.connection.model })
	})

	it('streams OpenAI SSE and stops at [DONE]', async () => {
		fetchMock.mockResolvedValue(
			streamResponse(['data: {"choices":[{"delta":{"content":"a"}}]}', '', 'data: {"choices":[{"delta":{"content":"b"}}]}', 'data: [DONE]']),
		)
		const text = await createClient({ ...DEFAULT_AI.connection, platform: 'openai', openaiApiKey: 'k' }).stream('p', () => {})
		expect(text).toBe('ab')
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer k')
	})

	it('streams Claude content deltas only', async () => {
		fetchMock.mockResolvedValue(
			streamResponse([
				'event: message_start',
				'data: {"type":"message_start"}',
				'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
			]),
		)
		const text = await createClient({ ...DEFAULT_AI.connection, platform: 'claude' }).stream('p', () => {})
		expect(text).toBe('hi')
	})

	it('turns an error body into a readable message', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => '{"error":{"message":"bad key"}}' })
		const result = await testConnection({ ...DEFAULT_AI.connection, platform: 'openai' })
		expect(result).toMatchObject({ ok: false, error: 'OpenAI: 401 Unauthorized · bad key' })
	})

	it('reports a working connection with its latency', async () => {
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: [{ text: 'OK' }] }) })
		const result = await testConnection({ ...DEFAULT_AI.connection, platform: 'claude', model: 'claude-sonnet-5' })
		expect(result).toMatchObject({ ok: true, reply: 'OK' })
	})
})

describe('Tyto AI', () => {
	it('is the default for new installs and keeps old platforms', () => {
		expect(DEFAULT_AI.connection.platform).toBe('tyto')
		expect(normalizeAi({ connection: { platform: 'ollama' } } as never).connection.platform).toBe('ollama')
	})

	it('refuses free-form prompts with a clear message', async () => {
		await expect(createClient({ ...DEFAULT_AI.connection, platform: 'tyto' }).ask('p')).rejects.toThrow(m.tytoAiNoChat())
	})

	it('needs a code before checking', async () => {
		const result = await testConnection({ ...DEFAULT_AI.connection, platform: 'tyto', tytoCode: '' })
		expect(result).toMatchObject({ ok: false, error: m.tytoAiNoCode() })
	})

	it('sends stamped lines and the recording length', () => {
		const segments = [
			{ start: 500, stop: 900, text: ' Привет ', speaker: 0 },
			{ start: 372_000, stop: 375_050, text: 'Итог' },
		]
		expect(tytoTranscript(segments, (n) => `Анна${n}`)).toBe('00:00:05 Анна0: Привет\n01:02:00 Итог')
		expect(recordingSeconds(segments)).toBe(3751)
	})

	it('saves topics under the summary', () => {
		expect(summaryMarkdown(' Итог ', [{ start: '00:01:00', title: 'Релиз' }], 'Темы')).toBe('Итог\n\n### Темы\n\n- **00:01:00** Релиз')
		expect(summaryMarkdown('Итог', [], 'Темы')).toBe('Итог')
	})

	it('splits the saved summary back into text and topics', () => {
		const saved = summaryMarkdown(
			'Итог встречи',
			[
				{ start: '00:01:00', title: 'Релиз' },
				{ start: '01:02:03', title: 'Сроки' },
			],
			'Темы',
		)
		expect(splitSummary(saved)).toEqual({
			text: 'Итог встречи',
			topics: [
				{ start: '00:01:00', seconds: 60, title: 'Релиз' },
				{ start: '01:02:03', seconds: 3723, title: 'Сроки' },
			],
		})
		expect(stampSeconds('12:30')).toBe(750)
	})

	it('leaves other summaries whole', () => {
		const md = '## Итоги\n\n- пункт\n\n### Задачи\n\n- [ ] позвонить'
		expect(splitSummary(md)).toEqual({ text: md, topics: [] })
	})
})
