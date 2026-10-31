import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type Json = any

// RFC 7396 JSON Merge Patch
function mergePatch(target: Json, patch: Json): Json {
	if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
		return patch
	}
	const result = target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {}
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) {
			delete result[key]
		} else {
			result[key] = mergePatch(result[key], value)
		}
	}
	return result
}

const tauriDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src-tauri')
const readJson = (name: string): Json => JSON.parse(readFileSync(resolve(tauriDir, name), 'utf-8'))

describe('tyto tauri config', () => {
	const upstream = readJson('tauri.conf.json')
	const merged = mergePatch(upstream, readJson('tauri.tyto.conf.json'))

	it('has Tyto name, version and identifier', () => {
		expect(merged.productName).toBe('Tyto')
		expect(merged.version).toBe('0.1.6')
		expect(merged.identifier).toBe('ru.eliseevdenis.tyto')
	})

	it('names the main binary tyto (tyto.exe, Contents/MacOS/tyto), not the crate name vibe', () => {
		expect(merged.mainBinaryName).toBe('tyto')
	})

	it('the installer removes the old vibe.exe and repoints autostart at tyto.exe', () => {
		const nsh = readFileSync(resolve(tauriDir, 'vc_redist.nsh'), 'utf-8')
		const hook = (name: string) => {
			const start = nsh.indexOf(`!macro ${name}`)
			expect(start).toBeGreaterThanOrEqual(0)
			return nsh.slice(start, nsh.indexOf('!macroend', start))
		}
		const removal = '!insertmacro RemoveOldMainBinary "vibe.exe"'
		// Only after tyto.exe is in place: an abort earlier must not leave the person with no exe.
		expect(hook('NSIS_HOOK_PREINSTALL')).not.toContain(removal)
		expect(hook('NSIS_HOOK_POSTINSTALL')).toContain(removal)
		expect(hook('NSIS_HOOK_POSTINSTALL')).toContain('$INSTDIR\\tyto.exe')
		// A locked leftover is non-fatal: removed on reboot, never an Abort or a prompt.
		const macro = hook('RemoveOldMainBinary')
		expect(macro).toContain('Delete /REBOOTOK')
		expect(macro).not.toContain('Abort')
		expect(macro).not.toContain('MessageBox')
	})

	it('uses its own updater endpoint and key', () => {
		expect(merged.plugins.updater.endpoints).toEqual(['https://github.com/des-e/tyto/releases/latest/download/latest.json'])
		expect(JSON.stringify(merged.plugins.updater)).not.toContain('thewh1teagle')
		expect(merged.plugins.updater.pubkey).not.toBe(upstream.plugins.updater.pubkey)
	})

	it('uses its own deep-link scheme', () => {
		expect(merged.plugins['deep-link'].desktop.schemes).toEqual(['tyto'])
	})

	it('builds nsis, dmg and app with ad-hoc macOS signing', () => {
		expect(merged.bundle.targets).toEqual(['nsis', 'dmg', 'app'])
		expect(merged.bundle.macOS.signingIdentity).toBe('-')
	})
})
