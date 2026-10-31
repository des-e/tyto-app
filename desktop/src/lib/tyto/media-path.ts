import * as pathApi from '@tauri-apps/api/path'
import * as fs from '@tauri-apps/plugin-fs'
import { videoExtensions } from '~/lib/config'
import { transcriptsFolder } from '~/lib/transcripts-store'

/**
 * Screen recordings live in `<projects>/Записи/`. The name is fixed: it does not follow the UI
 * language, so a folder made under one locale is still found under another.
 */
export const RECORDINGS_FOLDER = 'Записи'

function extensionOf(path: string) {
	const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
	const dot = name.lastIndexOf('.')
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isVideoPath(path: string): boolean {
	const extension = extensionOf(path)
	return !!extension && videoExtensions.includes(extension)
}

/** Video is referenced where it lies (it can be gigabytes); audio is copied into the project as before. */
export function shouldCopyMedia(path: string): boolean {
	return !isVideoPath(path)
}

/** Windows paths (drive letter or UNC) compare without case; posix paths compare exactly. */
function normalize(path: string) {
	const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
	const windows = /^[A-Za-z]:\//.test(slashed) || /^[A-Za-z]:$/.test(slashed) || slashed.startsWith('//')
	return { value: windows ? slashed.toLowerCase() : slashed, windows }
}

/** Whether `path` lies somewhere under `folder`, whichever separators either one uses. */
export function isInFolder(path: string, folder: string): boolean {
	if (!path || !folder) return false
	const child = normalize(path)
	const parent = normalize(folder)
	if (!parent.value) return false
	const parentValue = child.windows && !parent.windows ? parent.value.toLowerCase() : parent.value
	return child.value.startsWith(`${parentValue}/`)
}

/** Absolute path of `<projects>/Записи`, created on demand. */
export async function recordingsFolder(projectsPath?: string | null): Promise<string> {
	const folder = await pathApi.join(await transcriptsFolder(projectsPath), RECORDINGS_FOLDER)
	if (!(await fs.exists(folder))) await fs.mkdir(folder, { recursive: true })
	return folder
}
