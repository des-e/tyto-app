import { beforeAll, describe, expect, it } from 'vitest'
import { setLocale } from '~/paraglide/runtime.js'
import { batchSecondsLeft, fileSecondsLeft, timeLeftLabel } from './progress-eta'

beforeAll(() => setLocale('ru-RU', { reload: false }))

describe('оценка оставшегося времени', () => {
	it('одна запись: по скорости процентов', () => {
		// 25% за 60 с → еще 180 с
		expect(fileSecondsLeft(25, 0, 60_000)).toBe(180)
	})

	it('в начале оценки нет: модель разгоняется', () => {
		expect(fileSecondsLeft(2, 0, 60_000)).toBeNull()
		expect(fileSecondsLeft(50, 0, 3_000)).toBeNull()
		expect(fileSecondsLeft(50, undefined, 60_000)).toBeNull()
		expect(fileSecondsLeft(100, 0, 60_000)).toBeNull()
	})

	it('пакет: текущий файл плюс очередь по среднему готовых', () => {
		expect(batchSecondsLeft({ queued: 2, secondsPerFile: 100, running: { progress: 50, startedAt: 0 }, now: 40_000 })).toBe(240)
	})

	it('пакет без готовых файлов: темп берется из текущего файла', () => {
		// 50% за 40 с → файл целиком 80 с; еще 40 с + 2 × 80 с
		expect(batchSecondsLeft({ queued: 2, secondsPerFile: null, running: { progress: 50, startedAt: 0 }, now: 40_000 })).toBe(200)
		expect(batchSecondsLeft({ queued: 2, secondsPerFile: null, running: { progress: 1, startedAt: 0 }, now: 40_000 })).toBeNull()
	})

	it('подпись', () => {
		expect(timeLeftLabel(20)).toBe('осталось меньше минуты')
		expect(timeLeftLabel(180)).toBe('осталось около 3 мин')
		expect(timeLeftLabel(3900)).toBe('осталось около 1 ч 5 мин')
	})
})
