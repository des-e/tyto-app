import { useEffect, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { durationLabel } from './format'

/**
 * Sidebar history by day (docs/design/2026-10-25-tyto-visual-language.md, difference 5): «Сегодня /
 * Вчера / На этой неделе / Раньше», each row with «10:02 · 48 мин» under its name. Day boundaries are
 * local midnights; the week starts on Monday.
 */
export type RecentsGroupKey = 'today' | 'yesterday' | 'week' | 'earlier'

const ORDER: RecentsGroupKey[] = ['today', 'yesterday', 'week', 'earlier']

function startOfDay(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function daysBefore(date: Date, days: number) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days)
}

/** A record without a parsable stamp carries the epoch; it has no day to belong to. */
function hasDate(date: Date) {
	return date.getTime() > 0
}

export function recentsGroupOf(date: Date, now: Date): RecentsGroupKey {
	if (!hasDate(date)) return 'earlier'
	const today = startOfDay(now)
	if (date >= today) return 'today'
	if (date >= daysBefore(today, 1)) return 'yesterday'
	// getDay(): 0 = Sunday. Days since Monday: Monday 0 … Sunday 6.
	const weekStart = daysBefore(today, (today.getDay() + 6) % 7)
	return date >= weekStart ? 'week' : 'earlier'
}

/**
 * The moment the groups are relative to. It moves on at local midnight (so «Сегодня» becomes «Вчера»
 * in a window left open overnight) and whenever the window regains focus (after sleep, timers lag).
 */
export function useNow(): Date {
	const [now, setNow] = useState(() => new Date())
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout>
		const schedule = () => {
			const current = new Date()
			const midnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1)
			timer = setTimeout(() => {
				setNow(new Date())
				schedule()
			}, midnight.getTime() - current.getTime() + 1000)
		}
		const onFocus = () => {
			setNow(new Date())
			clearTimeout(timer)
			schedule()
		}
		schedule()
		window.addEventListener('focus', onFocus)
		return () => {
			clearTimeout(timer)
			window.removeEventListener('focus', onFocus)
		}
	}, [])
	return now
}

/** Keeps the incoming order inside each group; empty groups are left out. */
export function groupRecents<T>(items: readonly T[], dateOf: (item: T) => Date, now: Date): { key: RecentsGroupKey; items: T[] }[] {
	const buckets = new Map<RecentsGroupKey, T[]>()
	for (const item of items) {
		const key = recentsGroupOf(dateOf(item), now)
		const bucket = buckets.get(key)
		if (bucket) bucket.push(item)
		else buckets.set(key, [item])
	}
	return ORDER.filter((key) => buckets.has(key)).map((key) => ({ key, items: buckets.get(key)! }))
}

export function recentsGroupLabel(key: RecentsGroupKey): string {
	switch (key) {
		case 'today':
			return m.recentsToday()
		case 'yesterday':
			return m.recentsYesterday()
		case 'week':
			return m.recentsThisWeek()
		case 'earlier':
			return m.recentsEarlier()
	}
}

/** When, in the precision the group leaves open: the time today and yesterday, the weekday this week, the date before. */
function whenLabel(date: Date, now: Date) {
	if (!hasDate(date)) return ''
	const locale = getLocale()
	const group = recentsGroupOf(date, now)
	if (group === 'today' || group === 'yesterday') {
		return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
	}
	if (group === 'week') {
		const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
		return weekday.charAt(0).toLocaleUpperCase(locale) + weekday.slice(1)
	}
	const sameYear = date.getFullYear() === now.getFullYear()
	return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(date)
}

/** «10:02 · 48 мин»; either half drops out when it is unknown. */
export function recentMeta(date: Date, now: Date, durationSeconds: number | null | undefined): string {
	const when = whenLabel(date, now)
	const length = durationSeconds && durationSeconds > 0 ? durationLabel(durationSeconds) : ''
	return [when, length].filter(Boolean).join(' · ')
}
