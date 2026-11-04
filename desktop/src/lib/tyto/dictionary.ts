import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'

/**
 * «Словарь» is Whisper's initial prompt seen as a list of words: they are stored there joined with
 * commas, so a prompt written by hand before the dictionary existed opens as words too.
 */

/** Whisper reads at most this many prompt tokens (half of its 448-token context). */
export const PROMPT_TOKENS = 224

/** The words in a stored prompt: split on commas, semicolons and line breaks, blanks and repeats dropped. */
export function parseDictionary(prompt: string | undefined | null): string[] {
	const seen = new Set<string>()
	const words: string[] = []
	for (const raw of (prompt ?? '').split(/[,;\n]+/)) {
		const word = raw.trim().replace(/\s+/g, ' ')
		const key = word.toLocaleLowerCase()
		if (!word || seen.has(key)) continue
		seen.add(key)
		words.push(word)
	}
	return words
}

export function serializeDictionary(words: string[]): string {
	return parseDictionary(words.join(',')).join(', ')
}

/**
 * Rough token cost of a word in Whisper's tokenizer: Cyrillic splits into more pieces than Latin
 * (about 2.5 letters a token against 4), plus one for the comma and space between words.
 */
export function wordTokens(word: string): number {
	let tokens = 0
	for (const char of word) tokens += /[Ѐ-ӿ]/.test(char) ? 0.4 : 0.25
	return Math.ceil(tokens) + 1
}

/** Tokens the words take, and about how many more words of the same kind fit. */
export function dictionaryRoom(words: string[]): { used: number; more: number } {
	const used = words.reduce((total, word) => total + wordTokens(word), 0)
	const average = words.length ? used / words.length : 4
	return { used, more: Math.max(0, Math.floor((PROMPT_TOKENS - used) / average)) }
}

/** «12 слов», «1 слово», «3 слова» from the locale's plural rules. */
export function wordsLabel(count: number) {
	const form = new Intl.PluralRules(getLocale()).select(count)
	const value = { count: String(count) }
	if (form === 'one') return m.setWordsOne(value)
	if (form === 'few') return m.setWordsFew(value)
	return m.setWordsMany(value)
}
