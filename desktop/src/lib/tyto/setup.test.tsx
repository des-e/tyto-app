// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
	progress: null as null | ((event: { payload: unknown }) => void),
	downloadModel: vi.fn(),
	isModelFileUsable: vi.fn(),
	isOnline: true,
	navigate: vi.fn(),
	preference: {} as Record<string, unknown>,
}))

vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
		if (name === 'download_progress') h.progress = handler
		return () => {}
	}),
	emit: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (command: string) => (command === 'is_online' ? h.isOnline : command === 'get_models_folder' ? '/models' : null)),
}))
vi.mock('@tauri-apps/api/path', () => ({ join: async (...parts: string[]) => parts.join('/') }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(), message: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ locale: async () => 'ru-RU' }))
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => h.navigate }))
vi.mock('~/lib/model', async (importOriginal) => ({
	...(await importOriginal<typeof import('~/lib/model')>()),
	downloadModel: h.downloadModel,
	isModelFileUsable: h.isModelFileUsable,
}))
vi.mock('~/providers/preference', async (importOriginal) => ({
	...(await importOriginal<typeof import('~/providers/preference')>()),
	usePreferenceProvider: () => h.preference,
}))

import { setLocale } from '~/paraglide/runtime.js'
import SetupPage from '~/pages/setup/page'
import { SetupSteps, type SetupStepsModel } from './setup-steps'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'theme.css'), 'utf-8')

beforeAll(() => {
	setLocale('ru-RU', { reload: false })
})

afterEach(cleanup)

beforeEach(() => {
	h.progress = null
	h.isOnline = true
	h.downloadModel.mockReset()
	h.isModelFileUsable.mockReset()
	h.isModelFileUsable.mockResolvedValue(false)
	h.navigate.mockReset()
	h.preference = {
		diarizeEnabled: true,
		setDiarizeEnabled: vi.fn(),
		setModelPath: vi.fn(),
		setModelMetadata: vi.fn(),
		setSkippedSetup: vi.fn(),
		modelMetadata: null,
	}
})

const GB = 1_000_000_000

function mountPage() {
	return render(
		<MemoryRouter>
			<SetupPage />
		</MemoryRouter>,
	)
}

const step = (n: 1 | 2) => screen.queryByTestId(`setup-step-${n}`)

describe('первый запуск: шаги загрузки', () => {
	it('во время загрузки виден шаг 1 с размером, шаг 2 «Следующим»', async () => {
		h.downloadModel.mockReturnValue(new Promise(() => {}))
		mountPage()
		await waitFor(() => expect(h.progress).not.toBeNull())
		act(() => h.progress!({ payload: [1.0 * GB, 1.6 * GB] }))

		const first = step(1)!
		expect(within(first).getByText('Распознавание речи')).toBeTruthy()
		expect(within(first).getByText('1,0 из 1,6 ГБ')).toBeTruthy()
		expect(within(first).getByText('63%')).toBeTruthy()
		expect(first.getAttribute('data-state')).toBe('active')
		expect(within(step(2)!).getByText('Следующим')).toBeTruthy()
		expect(step(2)!.getAttribute('data-state')).toBe('waiting')
	})

	it('после перехода на модель говорящих активен шаг 2', async () => {
		h.downloadModel.mockResolvedValueOnce('/models/main.bin').mockReturnValueOnce(new Promise(() => {}))
		mountPage()
		await waitFor(() => expect(h.downloadModel).toHaveBeenCalledTimes(2))
		await waitFor(() => expect(step(2)!.getAttribute('data-state')).toBe('active'))
		expect(step(1)!.getAttribute('data-state')).toBe('done')
		expect(within(step(2)!).queryByText('Следующим')).toBeNull()
		act(() => h.progress!({ payload: [20_000_000, 40_000_000] }))
		expect(within(step(2)!).getByText('20 из 40 МБ')).toBeTruthy()
	})

	it('при выключенных говорящих шага 2 нет', async () => {
		h.preference.diarizeEnabled = false
		h.downloadModel.mockReturnValue(new Promise(() => {}))
		mountPage()
		await waitFor(() => expect(h.downloadModel).toHaveBeenCalled())
		expect(step(1)).not.toBeNull()
		expect(step(2)).toBeNull()
	})

	it('без сети: текст, «Повторить» и «Указать файл вручную»; сова стоит', async () => {
		h.isOnline = false
		mountPage()
		expect(await screen.findByText('Нет подключения к интернету')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Указать файл вручную' })).toBeTruthy()
		expect(screen.getByTestId('owl-walk').getAttribute('data-walking')).toBe('false')
		expect(h.downloadModel).not.toHaveBeenCalled()
	})

	it('«Повторить» снова проверяет сеть и начинает загрузку', async () => {
		h.isOnline = false
		h.downloadModel.mockReturnValue(new Promise(() => {}))
		mountPage()
		const retry = await screen.findByRole('button', { name: 'Повторить' })
		h.isOnline = true
		act(() => retry.click())
		await waitFor(() => expect(h.downloadModel).toHaveBeenCalled())
		expect(screen.queryByText('Нет подключения к интернету')).toBeNull()
		expect(screen.getByTestId('owl-walk').getAttribute('data-walking')).toBe('true')
	})
})

describe('SetupSteps', () => {
	const model = (over: Partial<SetupStepsModel> = {}): SetupStepsModel => ({
		step: 'speech',
		bytes: null,
		isOnline: true,
		speakersEnabled: true,
		cancelSetup: vi.fn(),
		downloadIfOnline: vi.fn(),
		...over,
	})

	it('сова идет во время загрузки и стоит без сети', () => {
		const { rerender } = render(<SetupSteps vm={model()} />)
		expect(screen.getByTestId('owl-walk').getAttribute('data-walking')).toBe('true')
		rerender(<SetupSteps vm={model({ isOnline: false })} />)
		expect(screen.getByTestId('owl-walk').getAttribute('data-walking')).toBe('false')
	})

	it('на экране одна сова — идущая, неподвижной над заголовком нет', () => {
		render(<SetupSteps vm={model()} />)
		expect(screen.queryByTestId('owl-mark')).toBeNull()
		expect(screen.getByTestId('owl-walk')).toBeTruthy()
	})

	it('кнопки загрузки: «Отменить загрузку» и «Указать файл модели вручную» ведут в настройки', () => {
		const vm = model()
		render(<SetupSteps vm={vm} />)
		screen.getByRole('button', { name: 'Отменить загрузку' }).click()
		screen.getByRole('button', { name: 'Указать файл модели вручную' }).click()
		expect(vm.cancelSetup).toHaveBeenCalledTimes(2)
		expect(screen.getByText('Записи расшифровываются на этом компьютере и никуда не отправляются.')).toBeTruthy()
	})
})

describe('OwlWalk: движение', () => {
	const block = (selector: string) => css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

	it('анимирует только transform', () => {
		const keyframes = [...css.matchAll(/@keyframes (tyto-owl-walk[\w-]*)\s*\{([\s\S]*?)\n\}/g)]
		expect(keyframes.length).toBeGreaterThanOrEqual(3)
		for (const [, , body] of keyframes) {
			expect(body).toContain('transform')
			expect(body).not.toMatch(/\b(left|right|top|margin|width|height|opacity)\s*:/)
		}
	})

	it('шаг 0.4 с, цикл туда и обратно 40 с, ход линейный', () => {
		expect(block('\\.tyto-owl-walk-body')).toMatch(/\b40s\b/)
		expect(block('\\.tyto-owl-walk-mover')).toMatch(/\b40s linear\b/)
	})

	it('на остановках лапы и корпус в покое, шаги только на ходу (разбор настоящим CSS-парсером)', () => {
		const root = postcss.parse(css)
		const rules = (name: string) => {
			const at = root.nodes.find((node) => node.type === 'atrule' && node.name === 'keyframes' && node.params === name) as postcss.AtRule
			expect(at, name).toBeTruthy()
			return (at.nodes ?? []) as postcss.Rule[]
		}
		// 6 rest stops (0, 2.5, 47.5, 52.5, 97.5, 100) + 88 pose stops (2 walking segments x 44).
		for (const name of ['tyto-owl-walk-bob', 'tyto-owl-walk-step-a', 'tyto-owl-walk-step-b']) {
			const stops = rules(name).flatMap((rule) => rule.selector.split(',').map((s) => s.trim()))
			// Every stop is a valid keyframe selector: no comma decimals (they would drop the whole rule).
			for (const stop of stops) expect(stop, name).toMatch(/^\d+(\.\d+)?%$/)
			expect(stops.length, name).toBe(94)
			expect(new Set(stops).size, name).toBe(94)
			for (const rule of rules(name)) expect(rule.toString(), name).toContain('transform:')
			const values = stops.map((s) => parseFloat(s))
			expect(values.filter((p) => (p > 47.5 && p < 52.5) || (p > 97.5 && p < 100))).toEqual([])
			expect(values.filter((p) => (p > 2.5 && p < 47.5) || (p > 52.5 && p < 97.5)).length).toBe(88)
		}
		const rest = rules('tyto-owl-walk-step-a').find((rule) => rule.toString().includes('translate(0, 0) rotate(0deg)'))
		expect(rest?.selector.split(',').map((s) => s.trim())).toEqual(['0%', '2.5%', '47.5%', '52.5%', '97.5%', '100%'])
	})
	it('при prefers-reduced-motion сова без анимации', () => {
		const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)?.join('\n') ?? ''
		expect(reduced).toMatch(/\.tyto-owl-walk[^{]*\{[^}]*animation: none/)
	})

	it('на ошибке сова стоит: лапки и корпус без анимации', () => {
		expect(css).toMatch(/\.tyto-owl-walk\[data-walking='false'\][^{]*\{[^}]*animation: none/)
	})
})
