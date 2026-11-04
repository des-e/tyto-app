// Shared fake state for the browser-mode Tauri mock.
// All paths are virtual POSIX-style paths under /mock.

export const HOME_FOLDER = '/mock/home'
export const MODELS_FOLDER = '/mock/models'
export const DOCUMENTS_FOLDER = '/mock/documents'
export const DOWNLOADS_FOLDER = '/mock/downloads'
export const APP_LOCAL_DATA = '/mock/app-data'
export const DEFAULT_MODEL_FILE = 'ggml-medium.bin'

// Virtual filesystem: path -> contents (string | Uint8Array | null for opaque binaries like models).
export const virtualFs = new Map<string, string | Uint8Array | null>([
	[`${MODELS_FOLDER}/${DEFAULT_MODEL_FILE}`, null],
	[`${DOCUMENTS_FOLDER}/sample.mp3`, null],
	[`${DOCUMENTS_FOLDER}/interview.mp4`, null],
	[`${DOCUMENTS_FOLDER}/meeting-notes.wav`, null],
])

// Pre-saved transcripts so the Recents sidebar has entries to open on first load.
// Shape, folder layout and stamp must match src/lib/transcripts-store.ts.
function record(name: string, texts: string[], audioFile?: string) {
	return JSON.stringify({
		version: 1,
		name,
		sourcePath: `${DOCUMENTS_FOLDER}/${name}.mp3`,
		createdAt: new Date().toISOString(),
		language: 'english',
		modelPath: `${MODELS_FOLDER}/${DEFAULT_MODEL_FILE}`,
		...(audioFile ? { audioFile } : {}),
		segments: texts.map((text, index) => ({ start: index * 300, stop: index * 300 + 280, text })),
	})
}

/** A project folder: the record plus the copy of the media it was transcribed from. */
function seedProject(name: string, stamp: string, texts: string[]) {
	const folder = `${DOCUMENTS_FOLDER}/Tyto/${name}-${stamp}`
	virtualFs.set(`${folder}/transcript.vibe.json`, record(name, texts, 'audio.mp3'))
	virtualFs.set(`${folder}/audio.mp3`, null)
}

seedProject('team-standup', '20260820-093015', [
	'Quick recap of what everyone shipped yesterday.',
	'The new release is scheduled for Friday morning.',
	'Open blockers move to the afternoon sync.',
])
seedProject('podcast-episode', '20260818-174200', [
	'Welcome back to the show, today we talk about local AI.',
	'On-device transcription keeps your audio private.',
	'Thanks for listening, see you next week.',
])

// A recording saved without its text yet: the «Запись еще не расшифрована» screen (design canvas page 2).
{
	const folder = `${DOCUMENTS_FOLDER}/Tyto/Запись 10∶35-20261103-103500`
	virtualFs.set(
		`${folder}/transcript.vibe.json`,
		JSON.stringify({
			version: 1,
			name: 'Запись 10∶35',
			sourcePath: `${folder}/audio.mp3`,
			createdAt: new Date(2026, 10, 3, 10, 35).toISOString(),
			audioFile: 'audio.mp3',
			durationSeconds: 12,
			segments: [],
		}),
	)
	virtualFs.set(`${folder}/audio.mp3`, null)
}

// A Russian meeting with speakers, a summary and topics: the transcript screen of the design canvas (page 3).
{
	const folder = `${DOCUMENTS_FOLDER}/Tyto/Планерка отдела продаж-20261029-100000`
	const lines: [number, number, string][] = [
		[0, 0, 'Давайте начнем с поставок. По второму складу сроки сдвигаются на неделю.'],
		[9, 1, 'Это из-за перевозчика? Они обещали машину на четверг.'],
		[14, 1, 'Если не успеют, клиенту надо сказать сегодня, а не в пятницу.'],
		[21, 0, 'Да, перевозчик. Я напишу клиенту после созвона и предложу частичную отгрузку.'],
		[33, 2, 'Частичную можем собрать к среде, остатки есть на первом складе.'],
		[460, 3, 'По частичной отгрузке: клиент обычно соглашается, если дать дату на остаток.'],
		[920, 0, 'Теперь бюджет на ноябрь. Предлагаю оставить как в октябре.'],
		[1445, 4, 'Перевозчика надо менять, это уже третий сдвиг за квартал.'],
		[1990, 5, 'Кладовщика ищем с понедельника, вакансия уже висит.'],
		[2490, 6, 'Итого: Денис пишет клиенту, Андрей собирает отгрузку к среде.'],
	]
	virtualFs.set(
		`${folder}/transcript.vibe.json`,
		JSON.stringify({
			version: 1,
			name: 'Планерка отдела продаж',
			sourcePath: `${DOCUMENTS_FOLDER}/planerka.mp3`,
			createdAt: new Date(2026, 9, 29, 10, 0).toISOString(),
			language: 'russian',
			audioFile: 'audio.mp3',
			segments: lines.map(([seconds, speaker, text], index) => ({
				start: seconds * 100,
				stop: (lines[index + 1]?.[0] ?? 2880) * 100 - 50,
				text,
				speaker,
			})),
			speakerNames: { 0: 'Денис', 1: 'Ольга Смирнова', 2: 'Андрей', 3: 'Мария Ковалева' },
			summary:
				'Обсудили сдвиг поставки по второму складу на неделю из-за перевозчика. Клиенту предложат частичную отгрузку в среду, Денис напишет ему сегодня. Еще согласовали бюджет на ноябрь и начали искать кладовщика.\n\n### Темы\n\n- **00:00** Поставки по второму складу\n- **07:40** Частичная отгрузка клиенту\n- **15:20** Бюджет на ноябрь\n- **24:05** Новый перевозчик\n- **33:10** Найм кладовщика\n- **41:30** Итоги и задачи',
		}),
	)
	virtualFs.set(`${folder}/audio.mp3`, null)
}

// One save in the pre-project-folder layout, so the mock keeps exercising back-compat.
virtualFs.set(
	`${DOCUMENTS_FOLDER}/Tyto/legacy-interview-20260810-101500.vibe.json`,
	record('legacy-interview', ['This transcript was saved as a flat file by an older build.', 'It still opens, renames and deletes in place.']),
)

export const sampleSegments: { start: number; stop: number; text: string; speaker?: number }[] = [
	{ start: 0, stop: 240, text: 'Добрый день, давайте начнем, все подключились.', speaker: 0 },
	{ start: 240, stop: 520, text: 'Сначала коротко по срокам, потом по бюджету.', speaker: 0 },
	{ start: 520, stop: 800, text: 'По срокам укладываемся, макеты будут в пятницу.', speaker: 1 },
	{ start: 800, stop: 1100, text: 'Отлично. Тогда бюджет согласуем на следующей встрече.', speaker: 0 },
	{ start: 1100, stop: 1400, text: 'Договорились, я пришлю смету до среды.', speaker: 1 },
]

// Tunables so flows are observable but fast.
export const TRANSCRIBE_SEGMENT_INTERVAL_MS = 700
export const DOWNLOAD_TICKS = 20
export const DOWNLOAD_TICK_MS = 150

export const mockPlatform = 'macos'
export const mockArch = 'aarch64'
export const appVersion = '9.9.9-mock'
export const appName = 'tyto'
