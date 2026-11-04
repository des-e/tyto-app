// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './segmented-control'

afterEach(cleanup)

const options = [
	{ value: 'light', label: 'Светлая' },
	{ value: 'dark', label: 'Тёмная' },
] as const

describe('SegmentedControl', () => {
	it('marks only the selected item: white segment on the grey track (design round 5)', () => {
		render(<SegmentedControl ariaLabel="Тема" value="light" options={[...options]} onChange={() => {}} />)
		const selected = screen.getByRole('radio', { name: 'Светлая' })
		const other = screen.getByRole('radio', { name: 'Тёмная' })

		expect(selected.getAttribute('aria-checked')).toBe('true')
		expect(selected.className).toContain('font-medium')
		expect(selected.dataset.selected).toBe('true')
		expect(selected.closest('[role="radiogroup"]')?.className).toContain('tyto-segmented')

		expect(other.getAttribute('aria-checked')).toBe('false')
		expect(other.className).toContain('text-muted-foreground')
		// The solid black plate is gone: theme.css draws the selected segment through .tyto-segmented.
		expect(selected.className).not.toContain('tyto-selected')
	})

	it('reports the clicked value', () => {
		const onChange = vi.fn()
		render(<SegmentedControl ariaLabel="Тема" value="light" options={[...options]} onChange={onChange} />)
		fireEvent.click(screen.getByRole('radio', { name: 'Тёмная' }))
		expect(onChange).toHaveBeenCalledWith('dark')
	})

	it('is the control Settings → General uses for the theme', () => {
		const here = dirname(fileURLToPath(import.meta.url))
		const general = readFileSync(resolve(here, '../../pages/settings/sections/general.tsx'), 'utf-8')
		expect(general).toContain('<SegmentedControl')
	})
})
