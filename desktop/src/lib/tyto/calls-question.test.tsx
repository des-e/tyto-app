// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
	preference: { meetingDetectionEnabled: false, setMeetingDetectionEnabled: vi.fn(), modelPath: '/m.bin' as string | null },
	asked: false,
}))

vi.mock('~/providers/preference', () => ({ usePreferenceProvider: () => h.preference }))
vi.mock('~/lib/config-store', () => ({
	usePersisted: (_key: string, initial: boolean) => {
		const [value, setValue] = useState(h.asked || initial)
		return [value, (next: boolean) => ((h.asked = next), setValue(next))]
	},
}))

import { setLocale } from '~/paraglide/runtime.js'
import { CallsQuestion } from './calls-question'

beforeAll(() => setLocale('ru-RU', { reload: false }))
beforeEach(() => {
	h.preference = { meetingDetectionEnabled: false, setMeetingDetectionEnabled: vi.fn(), modelPath: '/m.bin' }
	h.asked = false
})
afterEach(cleanup)

describe('вопрос про звонки на главном экране', () => {
	it('«Да, предлагать» включает обнаружение и больше не спрашивает', () => {
		const { rerender } = render(<CallsQuestion />)
		expect(screen.getByRole('region', { name: 'Предлагать запись, когда начинается звонок?' })).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Да, предлагать' }))
		expect(h.preference.setMeetingDetectionEnabled).toHaveBeenCalledWith(true)
		rerender(<CallsQuestion />)
		expect(screen.queryByRole('region')).toBeNull()
	})

	it('«Нет» только запоминает ответ', () => {
		render(<CallsQuestion />)
		fireEvent.click(screen.getByRole('button', { name: 'Нет' }))
		expect(h.preference.setMeetingDetectionEnabled).not.toHaveBeenCalled()
		expect(h.asked).toBe(true)
	})

	it('не спрашивает, если уже включено или модели еще нет', () => {
		h.preference.meetingDetectionEnabled = true
		const { rerender } = render(<CallsQuestion />)
		expect(screen.queryByRole('region')).toBeNull()
		h.preference.meetingDetectionEnabled = false
		h.preference.modelPath = null
		rerender(<CallsQuestion />)
		expect(screen.queryByRole('region')).toBeNull()
	})
})
