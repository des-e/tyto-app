import { describe, expect, it } from 'vitest'
import { withoutUnsupportedOptions, type ModelCapabilities } from './model'

const whisper: ModelCapabilities = {
	engine: 'whisper',
	requires_vad: false,
	languages: ['en'],
	language_detection: true,
	streaming: true,
	translation: true,
	timestamps: true,
	text_prompts: true,
}

const options = { lang: 'en', init_prompt: 'Punctuate. Use full sentences.', translate: true, n_threads: 4 }

describe('withoutUnsupportedOptions', () => {
	// Tyto has no translate switch (design round 8), so a value saved by an older build never reaches the engine.
	const { translate: _translate, ...withoutTranslate } = options

	it('sends the prompt to a model that takes prompts; translation never goes', () => {
		expect(withoutUnsupportedOptions(options, whisper)).toEqual(withoutTranslate)
	})

	it('drops the prompt and translation for engines that reject them, keeping the rest', () => {
		expect(withoutUnsupportedOptions(options, { ...whisper, engine: 'parakeet', text_prompts: false, translation: false })).toEqual({
			lang: 'en',
			n_threads: 4,
		})
	})

	it('keeps the rest when no capabilities are known yet', () => {
		expect(withoutUnsupportedOptions(options, null)).toEqual(withoutTranslate)
		expect(withoutUnsupportedOptions(options, undefined)).toEqual(withoutTranslate)
	})
})
