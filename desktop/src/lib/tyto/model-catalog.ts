import { m } from '~/paraglide/messages.js'

/** The three Whisper models «Модели» offers by name (design round 8); anything else is «Своя модель». */
export interface CatalogModel {
	file: string
	name: string
	info: () => string
	url: string
}

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export const MODEL_CATALOG: CatalogModel[] = [
	{ file: 'ggml-large-v3-turbo.bin', name: 'Whisper Large v3 Turbo', info: () => m.modTurboInfo(), url: `${HF}/ggml-large-v3-turbo.bin` },
	{ file: 'ggml-large-v3.bin', name: 'Whisper Large v3', info: () => m.modLargeInfo(), url: `${HF}/ggml-large-v3.bin` },
	{ file: 'ggml-medium.bin', name: 'Whisper Medium', info: () => m.modMediumInfo(), url: `${HF}/ggml-medium.bin` },
]

/** The file name at the end of a path, on either platform. */
export function fileName(path: string): string {
	return path.split(/[\\/]/).pop() ?? path
}
