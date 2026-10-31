import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'theme.css'), 'utf-8')
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf-8')

describe('Tyto: диалоги не лезут под кнопки окна macOS', () => {
	it('отступ задан только для html.mac-vibrancy и не меньше нижнего края кнопок', () => {
		const match = css.match(/html\.mac-vibrancy\s*\{\s*--tyto-titlebar-inset:\s*(\d+)px/)
		expect(match).not.toBeNull()
		// Кнопки: центр y=28 (setup.rs), диаметр 12, нижний край около 34.
		expect(Number(match![1])).toBeGreaterThanOrEqual(40)
		expect(css).not.toMatch(/^:root[^{]*--tyto-titlebar-inset/m)
	})

	it('правила для диалогов и настроек привязаны к mac-vibrancy', () => {
		for (const selector of ['.tyto-settings-frame', '.tyto-settings-card', '.tyto-dialog']) {
			expect(css).toContain(`html.mac-vibrancy ${selector}`)
		}
	})

	it('компоненты несут классы, на которые опираются правила', () => {
		expect(read('../../components/ui/dialog.tsx')).toContain('tyto-dialog ')
		const page = read('../../pages/settings/page.tsx')
		expect(page).toContain('tyto-settings-frame')
		expect(page).toContain('tyto-settings-card')
	})
})
