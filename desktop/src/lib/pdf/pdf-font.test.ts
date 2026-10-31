import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { create, type Font } from 'fontkit'
import { describe, expect, it } from 'vitest'

const FONT_DIRECTORY = fileURLToPath(new URL('../../assets/fonts/', import.meta.url))

function load(file: string) {
	const font = create(readFileSync(`${FONT_DIRECTORY}${file}`))
	return ('fonts' in font ? font.fonts[0] : font) as Font
}

/**
 * The bundled PDF font must really carry every script the export promises. A subset without
 * Cyrillic shipped once: react-pdf silently kept only the low byte of each code point, so
 * "блин" came out as "1;8=".
 */
describe.each([
	['Rubik-Regular.ttf', 400],
	['Rubik-Bold.ttf', 700],
])('%s', (file, weight) => {
	const font = load(file)

	it.each([
		['Cyrillic б', 0x431],
		['Cyrillic Ё', 0x401],
		['Hebrew א', 0x5d0],
		['Latin A', 0x41],
	])('has a glyph for %s', (_name, codePoint) => {
		expect(font.hasGlyphForCodePoint(codePoint)).toBe(true)
	})

	it(`is the static ${weight} weight`, () => {
		expect((font as unknown as { 'OS/2': { usWeightClass: number } })['OS/2'].usWeightClass).toBe(weight)
	})
})
