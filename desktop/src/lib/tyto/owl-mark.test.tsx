// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { FinishBlinkOwl, OwlMark } from './owl-mark'

afterEach(cleanup)

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'theme.css'), 'utf-8')

describe('OwlMark blink', () => {
	it('has no eyelids by default', () => {
		render(<OwlMark />)
		expect(screen.getByTestId('owl-mark').querySelectorAll('.tyto-owl-lid')).toHaveLength(0)
	})

	it('blinks once when asked: one lid per eye', () => {
		render(<OwlMark blink />)
		expect(screen.getByTestId('owl-mark').querySelectorAll('.tyto-owl-lid')).toHaveLength(2)
	})

	it('the blink animates transform only, runs once, and is static with reduced motion', () => {
		const keyframes = css.match(/@keyframes tyto-owl-blink\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
		expect(keyframes).toContain('transform')
		expect(keyframes).not.toMatch(/\b(height|width|top|left|opacity)\s*:/)
		expect(css).toMatch(/\.tyto-owl-lid\s*\{[^}]*animation: tyto-owl-blink [^;]* 1 /)
		expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.tyto-owl-lid[^{]*\{[^}]*animation: none/)
	})
})

describe('sidebar owl blinks when a transcription finishes (difference 12)', () => {
	type J = { id: string; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'; hydrated?: boolean }
	const lids = () => screen.getByTestId('owl-mark').querySelectorAll('.tyto-owl-lid').length

	it('does not blink on mount, even with finished or reopened transcripts around', () => {
		render(<FinishBlinkOwl jobs={[{ id: 'a', status: 'done' }, { id: 'b', status: 'done', hydrated: true }] as J[]} />)
		expect(lids()).toBe(0)
	})

	it('blinks when a running job becomes done, and again (remounted) on the next one', () => {
		const { rerender } = render(<FinishBlinkOwl jobs={[{ id: 'a', status: 'running' }, { id: 'b', status: 'queued' }] as J[]} />)
		expect(lids()).toBe(0)
		rerender(<FinishBlinkOwl jobs={[{ id: 'a', status: 'done' }, { id: 'b', status: 'running' }] as J[]} />)
		expect(lids()).toBe(2)
		const first = screen.getByTestId('owl-mark')
		rerender(<FinishBlinkOwl jobs={[{ id: 'a', status: 'done' }, { id: 'b', status: 'done' }] as J[]} />)
		expect(lids()).toBe(2)
		expect(screen.getByTestId('owl-mark')).not.toBe(first)
	})

	it('a failed or reopened transcript does not blink', () => {
		const { rerender } = render(<FinishBlinkOwl jobs={[{ id: 'a', status: 'running' }] as J[]} />)
		rerender(<FinishBlinkOwl jobs={[{ id: 'a', status: 'error' }, { id: 'b', status: 'done', hydrated: true }] as J[]} />)
		expect(lids()).toBe(0)
	})

	it('a file job going from running to done blinks', () => {
		const { rerender } = render(<FinishBlinkOwl jobs={[{ id: 'f', status: 'running' }] as J[]} />)
		rerender(<FinishBlinkOwl jobs={[{ id: 'f', status: 'done' }] as J[]} />)
		expect(lids()).toBe(2)
	})

	it('a hydrated job (recording or opened project) transcribed to done blinks', () => {
		const { rerender } = render(<FinishBlinkOwl jobs={[{ id: 'r', status: 'cancelled', hydrated: true }] as J[]} />)
		expect(lids()).toBe(0)
		rerender(<FinishBlinkOwl jobs={[{ id: 'r', status: 'running', hydrated: true }] as J[]} />)
		expect(lids()).toBe(0)
		rerender(<FinishBlinkOwl jobs={[{ id: 'r', status: 'done', hydrated: true }] as J[]} />)
		expect(lids()).toBe(2)
	})

	it('app start with already-done jobs, and jobs hydrated later as done, never blink', () => {
		const { rerender } = render(<FinishBlinkOwl jobs={[{ id: 'a', status: 'done' }] as J[]} />)
		rerender(<FinishBlinkOwl jobs={[{ id: 'a', status: 'done' }, { id: 'h', status: 'done', hydrated: true }] as J[]} />)
		rerender(<FinishBlinkOwl jobs={[{ id: 'h', status: 'done', hydrated: true }] as J[]} />)
		expect(lids()).toBe(0)
	})

	it('the sidebar header uses it', () => {
		const sidebar = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../pages/main/components/recents-sidebar.tsx'), 'utf-8')
		expect(sidebar).toMatch(/<FinishBlinkWordmark jobs=\{queue\.jobs\}/)
	})
})
