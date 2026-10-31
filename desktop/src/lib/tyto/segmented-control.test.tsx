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
	it('marks only the selected item with the high-contrast plate', () => {
		render(<SegmentedControl ariaLabel="Тема" value="light" options={[...options]} onChange={() => {}} />)
		const selected = screen.getByRole('radio', { name: 'Светлая' })
		const other = screen.getByRole('radio', { name: 'Тёмная' })

		expect(selected.getAttribute('aria-checked')).toBe('true')
		expect(selected.className).toContain('tyto-selected')
		expect(selected.dataset.selected).toBe('true')

		expect(other.getAttribute('aria-checked')).toBe('false')
		expect(other.className).not.toContain('tyto-selected')
		// The old look: a white segment on a near-white track — invisible in the light theme.
		expect(selected.className).not.toContain('bg-background')
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
