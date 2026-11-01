import { expect, test } from 'vitest'
import { displayElapsed, formatElapsed } from '~/lib/tyto/pill-time'

test('formatElapsed', () => {
	expect(formatElapsed(7_000)).toBe('0:07')
	expect(formatElapsed(725_000)).toBe('12:05')
	expect(formatElapsed(3_723_000)).toBe('1:02:03')
})

test('на паузе таймер стоит', () => {
	expect(displayElapsed({ status: 'paused', mode: 'audio', activeMs: 5_000 }, 0, 60_000)).toBe(5_000)
})

test('при записи время с последнего события прибавляется, при сохранении нет', () => {
	expect(displayElapsed({ status: 'recording', mode: 'audio', activeMs: 5_000 }, 1_000, 1_750)).toBe(5_750)
	expect(displayElapsed({ status: 'finishing', mode: 'audio', activeMs: 5_000 }, 0, 60_000)).toBe(5_000)
	expect(formatElapsed(999)).toBe('0:00')
	expect(formatElapsed(3_600_000)).toBe('1:00:00')
})
