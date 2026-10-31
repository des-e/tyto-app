import * as pathApi from '@tauri-apps/api/path'
import * as fs from '@tauri-apps/plugin-fs'
import { videoExtensions } from '~/lib/config'
import { TRANSCRIPT_FILENAME, transcriptsFolder } from '~/lib/transcripts-store'

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

/**
 * Windows paths (drive letter or UNC) compare without case; posix paths compare exactly. `.`
 * segments are dropped; a `..` segment is not resolved but reported, so the caller can refuse.
 */
function normalize(path: string) {
	const slashed = path.replace(/\\/g, '/')
	const windows = /^[A-Za-z]:(\/|$)/.test(slashed) || slashed.startsWith('//')
	const prefix = slashed.startsWith('//') ? '//' : slashed.startsWith('/') ? '/' : ''
	const segments = slashed
		.slice(prefix.length)
		.split('/')
		.filter((segment) => segment !== '' && segment !== '.')
	const joined = prefix + segments.join('/')
	return { value: windows ? joined.toLowerCase() : joined, windows, climbs: segments.includes('..') }
}

/**
 * Whether `path` lies somewhere under `folder`, whichever separators either one uses. Guards file
 * deletion, so any `..` in either path answers false rather than being resolved.
 */
export function isInFolder(path: string, folder: string): boolean {
	if (!path || !folder) return false
	const child = normalize(path)
	const parent = normalize(folder)
	if (child.climbs || parent.climbs) return false
	if (!parent.value || parent.value === '/' || parent.value === '//') return false
	const parentValue = child.windows && !parent.windows ? parent.value.toLowerCase() : parent.value
	return child.value.startsWith(`${parentValue}/`)
}

/**
 * The `Записи` folder beside a saved record: `<projects>/<project>/transcript.vibe.json` (or a legacy
 * flat `<projects>/<name>.vibe.json`) → `<projects>/Записи`. Pure string work, nothing is created, so
 * it also holds after the projects folder setting changed. `''` when the path has no parent.
 */
export function recordingsFolderFor(recordPath: string): string {
	const separator = recordPath.includes('/') ? '/' : '\\'
	const parent = parentOf(recordPath)
	const root = baseOf(recordPath) === TRANSCRIPT_FILENAME ? parentOf(parent) : parent
	return root ? `${root}${separator}${RECORDINGS_FOLDER}` : ''
}

function parentOf(path: string) {
	const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
	return index > 0 ? path.slice(0, index) : ''
}

function baseOf(path: string) {
	return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/** Absolute path of `<projects>/Записи`, created on demand. */
export async function recordingsFolder(projectsPath?: string | null): Promise<string> {
	const folder = await pathApi.join(await transcriptsFolder(projectsPath), RECORDINGS_FOLDER)
	if (!(await fs.exists(folder))) await fs.mkdir(folder, { recursive: true })
	return folder
}
