import { beforeAll, describe, expect, it } from 'vitest'
import { setLocale } from '~/paraglide/runtime.js'
import { dictionaryRoom, parseDictionary, PROMPT_TOKENS, serializeDictionary, wordTokens, wordsLabel } from './dictionary'

beforeAll(() => setLocale('ru-RU', { reload: false }))

describe('словарь', () => {
	it('слова из подсказки: запятые, точки с запятой и строки; пустые и повторы убираются', () => {
		expect(parseDictionary('Битрикс24, Телемост;\n  ЮKassa ,,телемост\n\nДенис  Елисеев')).toEqual(['Битрикс24', 'Телемост', 'ЮKassa', 'Денис Елисеев'])
		expect(parseDictionary(undefined)).toEqual([])
	})

	it('хранится через запятую', () => {
		expect(serializeDictionary(['CRM', ' Tyto ', 'crm'])).toBe('CRM, Tyto')
	})

	it('кириллица дороже латиницы', () => {
		expect(wordTokens('Телемост')).toBeGreaterThan(wordTokens('Telemost'))
	})

	it('сколько еще поместится', () => {
		expect(dictionaryRoom([]).more).toBe(PROMPT_TOKENS / 4)
		const words = ['Битрикс24', 'Телемост', 'ЮKassa', 'Денис Елисеев', 'Ольга Смирнова', 'ExtremeCode', 'CRM', 'Tyto']
		const room = dictionaryRoom(words)
		expect(room.used).toBeGreaterThan(0)
		expect(room.more).toBeGreaterThan(20)
		expect(room.more).toBeLessThan(60)
		expect(dictionaryRoom(Array(120).fill('Электрокардиограмма')).more).toBe(0)
	})

	it('число слов по-русски', () => {
		expect([1, 3, 12, 21].map(wordsLabel)).toEqual(['1 слово', '3 слова', '12 слов', '21 слово'])
	})
})
