// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setLocale } from '~/paraglide/runtime.js'
import { groupRecents, recentMeta, recentsGroupLabel, recentsGroupOf, useNow } from './recents-groups'

beforeAll(() => {
	setLocale('ru-RU', { reload: false })
})

// Thursday 22 October 2026, noon local time. The week started on Monday the 19th.
const now = new Date(2026, 9, 22, 12, 0)
const at = (day: number, hours = 10, minutes = 0, seconds = 0) => new Date(2026, 9, day, hours, minutes, seconds)

describe('recentsGroupOf', () => {
	it('сегодня начинается в локальную полночь', () => {
		expect(recentsGroupOf(at(22, 0, 0, 0), now)).toBe('today')
		expect(recentsGroupOf(at(22, 11, 59), now)).toBe('today')
		expect(recentsGroupOf(at(21, 23, 59, 59), now)).toBe('yesterday')
	})

	it('вчера: от полуночи вчера до полуночи сегодня', () => {
		expect(recentsGroupOf(at(21, 0, 0, 0), now)).toBe('yesterday')
		expect(recentsGroupOf(at(20, 23, 59, 59), now)).toBe('week')
	})

	it('на этой неделе: с понедельника, остальное раньше', () => {
		expect(recentsGroupOf(at(19, 0, 0, 0), now)).toBe('week')
		expect(recentsGroupOf(at(18, 23, 59, 59), now)).toBe('earlier')
		expect(recentsGroupOf(new Date(2025, 0, 1), now)).toBe('earlier')
	})

	it('в понедельник воскресенье это «Вчера», а суббота уже «Раньше»', () => {
		const monday = new Date(2026, 9, 19, 9, 0)
		expect(recentsGroupOf(at(18, 20), monday)).toBe('yesterday')
		expect(recentsGroupOf(at(17, 20), monday)).toBe('earlier')
	})

	it('запись без даты (эпоха) уходит в «Раньше»', () => {
		expect(recentsGroupOf(new Date(0), now)).toBe('earlier')
	})
})

describe('groupRecents', () => {
	it('раскладывает по группам в порядке Сегодня / Вчера / На этой неделе / Раньше, пустые пропускает', () => {
		const items = [
			{ id: 'a', date: at(22, 10) },
			{ id: 'b', date: at(22, 9) },
			{ id: 'c', date: at(20, 17) },
			{ id: 'd', date: new Date(2026, 8, 1) },
		]
		const groups = groupRecents(items, (item) => item.date, now)
		expect(groups.map((group) => group.key)).toEqual(['today', 'week', 'earlier'])
		expect(groups[0].items.map((item) => item.id)).toEqual(['a', 'b'])
		expect(groups[1].items.map((item) => item.id)).toEqual(['c'])
		expect(groups[2].items.map((item) => item.id)).toEqual(['d'])
	})

	it('подписи групп без капса', () => {
		expect(['today', 'yesterday', 'week', 'earlier'].map((key) => recentsGroupLabel(key as never))).toEqual([
			'Сегодня',
			'Вчера',
			'На этой неделе',
			'Раньше',
		])
	})
})

describe('useNow', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('сдвигается в локальную полночь и при возврате фокуса в окно', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date(2026, 9, 22, 23, 59, 0))
		const { result } = renderHook(() => useNow())
		expect(result.current.getDate()).toBe(22)
		act(() => {
			vi.advanceTimersByTime(2 * 60_000)
		})
		expect(result.current.getDate()).toBe(23)

		vi.setSystemTime(new Date(2026, 9, 25, 9, 0))
		act(() => {
			window.dispatchEvent(new Event('focus'))
		})
		expect(result.current.getDate()).toBe(25)
	})
})

describe('recentMeta', () => {
	it('сегодня и вчера: время и длительность «10:02 · 48 мин»', () => {
		expect(recentMeta(at(22, 10, 2), now, 48 * 60)).toBe('10:02 · 48 мин')
		expect(recentMeta(at(21, 17, 40), now, 65 * 60)).toBe('17:40 · 1 ч 5 мин')
	})

	it('на этой неделе: день недели «Пн · 31 мин»', () => {
		expect(recentMeta(at(19, 9), now, 31 * 60)).toBe('Пн · 31 мин')
	})

	it('раньше: дата', () => {
		expect(recentMeta(new Date(2026, 9, 12, 9), now, 22 * 60)).toMatch(/^12 окт\.? · 22 мин$/)
	})

	it('без длительности: только время; без даты: только длительность', () => {
		expect(recentMeta(at(22, 10, 2), now, null)).toBe('10:02')
		expect(recentMeta(new Date(0), now, 48 * 60)).toBe('48 мин')
		expect(recentMeta(new Date(0), now, null)).toBe('')
	})
})
