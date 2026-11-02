import { invoke } from '@tauri-apps/api/core'
import { ask } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import { toast } from 'sonner'
import type { PermissionStatus } from '~/lib/permissions'
import { readConfig, writeConfig } from '~/lib/config-store'
import { m } from '~/paraglide/messages.js'

/** Set once the person has seen why Tyto needs Screen Recording. */
export const SCREEN_PERMISSION_EXPLAINED_KEY = 'recording.screenPermissionExplained'

/**
 * Before choosing what to record on a Mac: is Screen Recording allowed? Granted → true. The first
 * time it is not, an explanation with «Открыть настройки»: the request puts Tyto into the list in
 * System Settings, then the settings open. macOS applies the switch only after a restart, so this
 * returns false. Later times go straight to the request (macOS shows its own prompt, if any).
 * Windows: always true, nothing is asked.
 */
export async function ensureScreenRecordingPermission(): Promise<boolean> {
	if (platform() !== 'macos') return true
	try {
		const status = await invoke<PermissionStatus>('get_screen_recording_permission_status')
		if (status === 'granted' || status === 'not_applicable') return true
	} catch (error) {
		console.error('screen recording permission status:', error)
	}

	if (!readConfig(SCREEN_PERMISSION_EXPLAINED_KEY, false)) {
		writeConfig(SCREEN_PERMISSION_EXPLAINED_KEY, true)
		const open = await ask(m.tytoScreenPermissionBody(), {
			title: m.tytoScreenPermissionTitle(),
			kind: 'info',
			okLabel: m.tytoScreenPermissionOpen(),
			cancelLabel: m.tytoCancel(),
		}).catch(() => false)
		if (!open) return false
		if ((await request()) === 'granted') return true
		await openSettings()
		return false
	}

	if ((await request()) === 'granted') return true
	// Not silent: the button did nothing visible otherwise.
	toast.error(m.tytoScreenPermissionTitle(), {
		action: { label: m.tytoScreenPermissionOpen(), onClick: () => void openSettings() },
	})
	return false
}

function openSettings() {
	return invoke('open_screen_recording_settings').catch((error) => console.error('open screen recording settings:', error))
}

async function request(): Promise<PermissionStatus> {
	try {
		return await invoke<PermissionStatus>('request_screen_recording_permission')
	} catch (error) {
		console.error('request screen recording permission:', error)
		return 'denied'
	}
}
