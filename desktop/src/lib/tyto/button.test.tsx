// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from '~/components/ui/button'

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

const NEW_VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'] as const

describe('Tyto button system', () => {
	it.each(NEW_VARIANTS)('variant %s renders its own class', (variant) => {
		render(<Button variant={variant}>Сохранить PDF</Button>)
		const button = screen.getByRole('button', { name: 'Сохранить PDF' })
		expect(button.className).toContain(`tyto-btn-${variant}`)
		for (const other of NEW_VARIANTS.filter((v) => v !== variant)) expect(button.className).not.toContain(`tyto-btn-${other}`)
	})

	it('a disabled ghost button gets no hover plate', () => {
		render(<Button variant="ghost" disabled>Отмена</Button>)
		expect(screen.getByRole('button').className).toContain('disabled:hover:bg-transparent')
	})

	it('defaults to the primary variant at md size', () => {
		render(<Button>Расшифровать</Button>)
		const button = screen.getByRole('button')
		expect(button.className).toContain('tyto-btn-primary')
		expect(button.className).toContain('h-9')
	})

	it('sizes: sm is 28px, md is 36px, weight 500, no pill radius', () => {
		render(
			<>
				<Button size="sm">Маленькая</Button>
				<Button size="md">Обычная</Button>
			</>,
		)
		const sm = screen.getByRole('button', { name: 'Маленькая' })
		const md = screen.getByRole('button', { name: 'Обычная' })
		expect(sm.className).toContain('h-7')
		expect(sm.className).toContain('rounded-[var(--tyto-r-sm)]')
		expect(md.className).toContain('h-9')
		expect(md.className).toContain('rounded-[var(--tyto-r-md)]')
		for (const button of [sm, md]) {
			expect(button.className).toContain('font-medium')
			expect(button.className).not.toContain('font-semibold')
			expect(button.className).not.toContain('rounded-full')
		}
	})

	it('disabled is an explicit grey fill, never half transparent', () => {
		render(
			<Button variant="primary" disabled>
				Сохранить PDF
			</Button>,
		)
		const button = screen.getByRole('button')
		expect(button.className).not.toMatch(/opacity-50/)
		expect(button.className).toContain('disabled:bg-muted')
		expect(button.className).toContain('disabled:text-[var(--tyto-disabled-fg)]')
		expect(button.className).toContain('disabled:cursor-not-allowed')
	})

	it('keyboard focus is a solid 2px outline instead of a translucent ring', () => {
		render(<Button>Ок</Button>)
		const button = screen.getByRole('button')
		expect(button.className).toContain('focus-visible:outline-2')
		expect(button.className).toContain('focus-visible:outline-offset-2')
		expect(button.className).not.toContain('focus-visible:ring')
	})

	it('presses with scale .97 and stays still with reduced motion', () => {
		render(<Button>Ок</Button>)
		const button = screen.getByRole('button')
		expect(button.className).toContain('scale-[.97]')
		expect(button.className).toContain('motion-reduce:transition-none')
	})

	it('iconOnly renders a square and keeps its accessible name', () => {
		render(
			<Button iconOnly variant="ghost" aria-label="Поиск">
				<svg />
			</Button>,
		)
		const button = screen.getByRole('button', { name: 'Поиск' })
		expect(button.className).toContain('w-8')
		expect(button.className).toContain('h-8')
	})

	it('iconOnly without aria-label is reported', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		render(
			// @ts-expect-error iconOnly requires aria-label
			<Button iconOnly>
				<svg />
			</Button>,
		)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('aria-label'))
	})
})

describe('upstream Vibe variant names still work', () => {
	const cases = [
		['default', 'primary'],
		['outline', 'secondary'],
		['secondary', 'secondary'],
		['ghost', 'ghost'],
		['destructive', 'destructive'],
		['link', 'link'],
	] as const

	it.each(cases)('variant %s renders as %s', (upstream, mapped) => {
		render(<Button variant={upstream}>Кнопка</Button>)
		expect(screen.getByRole('button').className).toContain(`tyto-btn-${mapped}`)
	})

	it.each(['default', 'sm', 'lg', 'icon', 'iconSm'] as const)('size %s renders', (size) => {
		render(
			<Button size={size} aria-label="Кнопка">
				Кнопка
			</Button>,
		)
		expect(screen.getByRole('button')).toBeTruthy()
	})

	it('legacy icon sizes are the 32 and 28 px squares', () => {
		render(
			<>
				<Button size="icon" aria-label="Большая" />
				<Button size="iconSm" aria-label="Малая" />
			</>,
		)
		expect(screen.getByRole('button', { name: 'Большая' }).className).toMatch(/\bh-8\b.*\bw-8\b|\bw-8\b.*\bh-8\b/)
		expect(screen.getByRole('button', { name: 'Малая' }).className).toMatch(/\bh-7\b.*\bw-7\b|\bw-7\b.*\bh-7\b/)
	})

	it('caller className still overrides through tailwind-merge', () => {
		render(<Button className="h-auto px-0">Кнопка</Button>)
		const button = screen.getByRole('button')
		expect(button.className).toContain('h-auto')
		expect(button.className).not.toContain('h-9')
	})
})
