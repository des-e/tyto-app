// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { FinishBlinkWordmark, Wordmark } from './wordmark'

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))

describe('Wordmark 8c', () => {
	it('is an image named «Tyto» and follows the theme through currentColor', () => {
		render(<Wordmark />)
		const mark = screen.getByRole('img', { name: 'Tyto' })
		expect(mark.getAttribute('fill')).toBe('currentColor')
		expect(mark.querySelectorAll('.tyto-owl-lid').length).toBe(0)
	})

	it('blinks the owl once when a transcription finishes', () => {
		const running = [{ id: 'a', status: 'running' }]
		const { rerender } = render(<FinishBlinkWordmark jobs={running} />)
		expect(screen.getByRole('img', { name: 'Tyto' }).querySelectorAll('.tyto-owl-lid').length).toBe(0)
		rerender(<FinishBlinkWordmark jobs={[{ id: 'a', status: 'done' }]} />)
		expect(screen.getByRole('img', { name: 'Tyto' }).querySelectorAll('.tyto-owl-lid').length).toBe(2)
	})

	it('the sidebar brand row renders it instead of typed text', () => {
		const sidebar = readFileSync(resolve(here, '../../pages/main/components/recents-sidebar.tsx'), 'utf-8')
		expect(sidebar).toContain("from '~/lib/tyto/wordmark'")
		expect(sidebar).toMatch(/<FinishBlinkWordmark jobs=\{queue\.jobs\}/)
		expect(sidebar).not.toContain('m.appTitle()')
	})

	it('matches the designer lockup-small.svg paths', () => {
		const svg = readFileSync(resolve(here, '../../../../design/tyto/logo/lockup-small.svg'), 'utf-8')
		const component = readFileSync(resolve(here, 'wordmark.tsx'), 'utf-8')
		const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((match) => match[1])
		expect(paths.length).toBeGreaterThan(5)
		for (const d of paths) expect(component, d.slice(0, 24)).toContain(d)
	})
})
