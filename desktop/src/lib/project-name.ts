import type { ProjectSource } from './types'
import { audioExtensions, videoExtensions } from './config'

const sourcePrefixes: Record<ProjectSource, string> = {
	record: 'Record-',
	url: 'Url-',
	file: 'File-',
}

const mediaExtensions = new Set([...audioExtensions, ...videoExtensions])

function withoutMediaExtension(name: string): string {
	const dot = name.lastIndexOf('.')
	const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
	return mediaExtensions.has(extension) ? name.slice(0, dot) : name
}

/**
 * A new recording's project name: «Запись 10∶35» (Tyto, design round C). The separator is U+2236
 * RATIO, which looks like a colon but is allowed in folder names on Windows, so the name survives
 * the round trip through the project folder unchanged.
 */
export function recordProjectName(date: Date, label: (time: string) => string): string {
	const hours = String(date.getHours()).padStart(2, '0')
	const minutes = String(date.getMinutes()).padStart(2, '0')
	return label(`${hours}∶${minutes}`)
}

/** Build the default saved-project name. User-entered names never pass through this helper. */
export function autoProjectName(name: string, source: ProjectSource = 'file'): string {
	return `${sourcePrefixes[source]}${withoutMediaExtension(name)}`
}

/** Turn the visible project title into a safe, recognizable export filename. */
export function projectExportFilename(name: string, extension: string): string {
	const cleaned = withoutMediaExtension(name)
		.replace(/[/\\?%*:|"<>]/g, '-')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[. ]+|[. ]+$/g, '')
		.slice(0, 120)
	const safeStem = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned || 'transcript'
	const safeExtension =
		extension
			.replace(/^\.+/, '')
			.replace(/[^a-z0-9]/gi, '')
			.toLowerCase() || 'txt'
	return `${safeStem}.${safeExtension}`
}
