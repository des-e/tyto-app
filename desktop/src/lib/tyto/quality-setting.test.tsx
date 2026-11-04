// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('~/components/shortcut-recorder', () => ({ default: () => null }))
vi.mock('~/components/meeting-service-icons', () => ({ GoogleMeetIcon: () => null, ZoomIcon: () => null, MicrosoftTeamsIcon: () => null }))
vi.mock('~/providers/recording-shortcut', () => ({
	useRecordingShortcut: () => ({ recordingShortcutEnabled: false, setRecordingShortcutEnabled: () => {} }),
}))
// A stand-in for the persisted preference: reads and writes `store` under the real config key.
vi.mock('~/providers/preference', async () => {
	const { useState } = await import('react')
	const { CONFIG_KEYS } = await import('~/lib/config-keys')
	return {
		usePreferenceProvider: () => {
			const [screenQuality, setLocal] = useState(store.values[CONFIG_KEYS.screenQuality] ?? 'good')
			return {
				meetingDetectionEnabled: false,
				setMeetingDetectionEnabled: () => {},
				autoTranscribeAfterRecording: false,
				setAutoTranscribeAfterRecording: () => {},
				screenQuality,
				setScreenQuality: (value: string) => {
					store.values[CONFIG_KEYS.screenQuality] = value
					setLocal(value)
				},
			}
		},
	}
})

import { CONFIG_KEYS } from '~/lib/config-keys'
import { setLocale } from '~/paraglide/runtime.js'
import { RecordingSection } from '~/pages/settings/sections/recording'

beforeAll(() => setLocale('ru-RU', { reload: false }))
beforeEach(() => {
	store.values = {}
})
afterEach(cleanup)

describe('настройка качества видео', () => {
	it('ключ настройки recording.screenQuality', () => {
		expect(CONFIG_KEYS.screenQuality).toBe('recording.screenQuality')
	})

	it('«Качество видео» по умолчанию «Хорошее», выбор «Высокое» сохраняется в recording.screenQuality', () => {
		render(<RecordingSection />)
		const group = screen.getByRole('radiogroup', { name: 'Качество видео' })
		expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe('Хорошее')
		expect(screen.getByText('До 1080p, 15 кадров в секунду, около 1 ГБ в час')).toBeTruthy()

		fireEvent.click(screen.getByRole('radio', { name: 'Высокое' }))
		expect(store.values['recording.screenQuality']).toBe('high')
		expect(screen.getByRole('radiogroup', { name: 'Качество видео' }).querySelector('[aria-checked="true"]')?.textContent).toBe('Высокое')
		expect(screen.getByText('До 1080p, 30 кадров в секунду, около 2 ГБ в час')).toBeTruthy()
	})
})
