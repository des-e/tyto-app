import { beforeEach, describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({
	files: new Map<string, string>(),
	directories: new Set<string>(),
	copies: [] as [string, string][],
	removed: [] as string[],
}))

vi.mock('@tauri-apps/api/path', async () => {
	const path = await import('node:path')
	return {
		documentDir: async () => '/documents',
		join: async (...parts: string[]) => path.posix.join(...parts),
		dirname: async (value: string) => path.posix.dirname(value),
		basename: async (value: string) => path.posix.basename(value),
	}
})

vi.mock('@tauri-apps/plugin-fs', () => ({
	exists: async (path: string) => disk.files.has(path) || disk.directories.has(path),
	mkdir: async (path: string, options?: { recursive?: boolean }) => {
		if (disk.directories.has(path) && !options?.recursive) throw new Error(`exists: ${path}`)
		disk.directories.add(path)
	},
	writeTextFile: async (path: string, value: string) => {
		disk.files.set(path, value)
	},
	readTextFile: async (path: string) => {
		const value = disk.files.get(path)
		if (value === undefined) throw new Error(`missing: ${path}`)
		return value
	},
	copyFile: async (source: string, target: string) => {
		disk.copies.push([source, target])
		const value = disk.files.get(source)
		if (value === undefined) throw new Error(`missing: ${source}`)
		disk.files.set(target, value)
	},
	rename: async (source: string, target: string) => {
		const value = disk.files.get(source)
		if (value === undefined) throw new Error(`missing: ${source}`)
		disk.files.set(target, value)
		disk.files.delete(source)
	},
	remove: async (path: string, options?: { recursive?: boolean }) => {
		disk.removed.push(path)
		disk.files.delete(path)
		if (options?.recursive) {
			for (const file of [...disk.files.keys()]) if (file.startsWith(`${path}/`)) disk.files.delete(file)
			for (const directory of [...disk.directories]) if (directory === path || directory.startsWith(`${path}/`)) disk.directories.delete(directory)
		}
	},
	readDir: async () => [],
}))

import { deleteTranscript, readTranscript, saveTranscript, updateTranscriptMedia } from '~/lib/transcripts-store'
import { isInFolder, isVideoPath, recordingsFolder, RECORDINGS_FOLDER, shouldCopyMedia } from './media-path'

const createdAt = new Date(2026, 9, 31, 10, 20, 30)

beforeEach(() => {
	disk.files.clear()
	disk.directories.clear()
	disk.copies = []
	disk.removed = []
})

describe('внешние медиа в проектах', () => {
	it('видео не копируется в проект, путь к исходнику сохранен', async () => {
		disk.files.set('D:/zoom/meet.mp4', 'video')
		const saved = await saveTranscript({ name: 'meet', sourcePath: 'D:/zoom/meet.mp4', segments: [], createdAt })
		expect(saved).not.toBeNull()
		expect(disk.copies).toEqual([])
		const record = await readTranscript(saved!.recordPath)
		expect(record?.sourcePath).toBe('D:/zoom/meet.mp4')
		expect(record?.audioFile).toBeUndefined()
		expect(saved!.mediaPath).toBe('D:/zoom/meet.mp4')
	})

	it('аудио копируется как раньше', async () => {
		disk.files.set('D:/a/call.mp3', 'audio')
		const saved = await saveTranscript({ name: 'call', sourcePath: 'D:/a/call.mp3', segments: [], createdAt })
		const project = '/documents/Tyto/call-20261031-102030'
		expect(disk.copies).toEqual([['D:/a/call.mp3', `${project}/audio.mp3`]])
		expect((await readTranscript(saved!.recordPath))?.audioFile).toBe('audio.mp3')
	})

	it('copyMedia: false не копирует даже аудио', async () => {
		const source = `/documents/Tyto/${RECORDINGS_FOLDER}/call.m4a`
		disk.files.set(source, 'audio')
		const saved = await saveTranscript({ name: 'call', sourcePath: source, copyMedia: false, segments: [], createdAt })
		expect(disk.copies).toEqual([])
		const record = await readTranscript(saved!.recordPath)
		expect(record?.sourcePath).toBe(source)
		expect(record?.audioFile).toBeUndefined()
		expect(disk.files.has(source)).toBe(true)
	})

	it('moveSourceMedia: true по-прежнему копирует видео', async () => {
		disk.files.set('/tmp/clip.mp4', 'video')
		const saved = await saveTranscript({ name: 'clip', sourcePath: '/tmp/clip.mp4', moveSourceMedia: true, segments: [], createdAt })
		expect(disk.copies).toHaveLength(1)
		expect((await readTranscript(saved!.recordPath))?.audioFile).toBe('audio.mp4')
	})

	it('durationSeconds сохраняется и читается', async () => {
		disk.files.set('D:/zoom/meet.mp4', 'video')
		const saved = await saveTranscript({ name: 'meet', sourcePath: 'D:/zoom/meet.mp4', durationSeconds: 1830, segments: [], createdAt })
		expect((await readTranscript(saved!.recordPath))?.durationSeconds).toBe(1830)
	})

	it('updateTranscriptMedia меняет путь и убирает audioFile', async () => {
		disk.files.set('D:/a/call.mp3', 'audio')
		const saved = await saveTranscript({ name: 'call', sourcePath: 'D:/a/call.mp3', segments: [{ start: 0, stop: 100, text: 'Привет' }], createdAt })
		expect(await updateTranscriptMedia(saved!.recordPath, 'E:/moved/call.mp3')).toBe(true)
		const record = await readTranscript(saved!.recordPath)
		expect(record?.sourcePath).toBe('E:/moved/call.mp3')
		expect(record?.audioFile).toBeUndefined()
		expect(record?.segments).toHaveLength(1)
	})

	it('deleteTranscript с deleteMedia удаляет и файл записи', async () => {
		const source = `/documents/Tyto/${RECORDINGS_FOLDER}/screen.mp4`
		disk.files.set(source, 'video')
		const saved = await saveTranscript({ name: 'screen', sourcePath: source, segments: [], createdAt })
		expect(await deleteTranscript(saved!.recordPath, { deleteMedia: true })).toBe(true)
		expect(disk.files.has(source)).toBe(false)
		expect(disk.files.has(saved!.recordPath)).toBe(false)
	})

	it('deleteTranscript без deleteMedia файл записи не трогает', async () => {
		disk.files.set('D:/zoom/meet.mp4', 'video')
		const saved = await saveTranscript({ name: 'meet', sourcePath: 'D:/zoom/meet.mp4', segments: [], createdAt })
		expect(await deleteTranscript(saved!.recordPath)).toBe(true)
		expect(disk.files.has('D:/zoom/meet.mp4')).toBe(true)
	})

	it('isInFolder: C:\\Users\\D\\Documents\\Tyto\\Записи\\a.mp4 внутри c:/users/d/documents/tyto/Записи', () => {
		expect(isInFolder('C:\\Users\\D\\Documents\\Tyto\\Записи\\a.mp4', 'c:/users/d/documents/tyto/Записи')).toBe(true)
		expect(isInFolder('C:\\Users\\D\\Documents\\Tyto\\Записи 2\\a.mp4', 'c:/users/d/documents/tyto/Записи')).toBe(false)
		expect(isInFolder('/Users/d/Documents/Tyto/Записи/a.mp4', '/Users/d/Documents/Tyto/Записи/')).toBe(true)
		expect(isInFolder('/Users/d/Documents/Tyto/записи/a.mp4', '/Users/d/Documents/Tyto/Записи')).toBe(false)
		expect(isInFolder('', '/Users/d/Documents/Tyto/Записи')).toBe(false)
	})

	it('видео распознается по расширению без учета регистра', () => {
		expect(isVideoPath('D:/zoom/MEET.MP4')).toBe(true)
		expect(isVideoPath('D:/a/call.mp3')).toBe(false)
		expect(shouldCopyMedia('D:/a/call.mp3')).toBe(true)
		expect(shouldCopyMedia('D:/zoom/meet.mkv')).toBe(false)
	})

	it('recordingsFolder создает Записи в папке проектов', async () => {
		expect(await recordingsFolder('/custom')).toBe(`/custom/${RECORDINGS_FOLDER}`)
		expect(disk.directories.has(`/custom/${RECORDINGS_FOLDER}`)).toBe(true)
	})
})
