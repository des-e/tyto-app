import { beforeAll, describe, expect, it } from 'vitest'
import { setLocale } from '~/paraglide/runtime.js'
import { aiExportText } from './ai-export'

beforeAll(() => setLocale('ru-RU', { reload: false }))

describe('экспорт «ИИ-разбор»', () => {
	it('саммари, темы, последний разбор и вопросы одним текстом', () => {
		const text = aiExportText({
			summary: 'Обсудили сроки.\n\n### Темы\n\n- **00:00:37** Сроки\n- **00:05:10** Бюджет',
			thread: [
				{ question: 'ИИ-разбор', answer: 'старый разбор' },
				{ question: 'Что решили?', answer: 'Перенести на среду.' },
				{ question: 'ИИ-разбор', answer: 'Задачи: Денис пишет клиенту.' },
			],
		})
		expect(text).toBe(
			[
				'## Саммари\n\nОбсудили сроки.',
				'## Темы\n\n- 00:00:37 Сроки\n- 00:05:10 Бюджет',
				'## ИИ-разбор\n\nЗадачи: Денис пишет клиенту.',
				'## Спросить об этой расшифровке\n\n**Что решили?**\n\nПеренести на среду.',
			].join('\n\n'),
		)
	})

	it('без ИИ пусто: карточка «ИИ-разбор» неактивна', () => {
		expect(aiExportText({})).toBe('')
		expect(aiExportText({ summary: '  ', thread: [] })).toBe('')
	})
})

describe('ИИ-разбор не в Markdown', () => {
	it('без «##» и «**»: заголовок своей строкой', async () => {
		const { plainAiText } = await import('./ai-export')
		expect(plainAiText('## Саммари\n\nТекст\n\n**Что решили?**\n\nСреда, **важно**')).toBe('Саммари\n\nТекст\n\nЧто решили?\n\nСреда, важно')
	})
})
