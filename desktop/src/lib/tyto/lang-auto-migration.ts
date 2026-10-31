import { CONFIG_KEYS } from '~/lib/config-keys'
import { readConfig, writeConfig } from '~/lib/config-store'

/** Set once the check below has run, so it never touches the language again. */
export const LANG_AUTO_MIGRATED_KEY = 'tyto.langAutoMigrated'

/**
 * Tyto 0.1.x stored English as the transcription language without the user ever choosing it.
 * Since auto-detection became the default, such an install switches to it once. An English
 * picked from the list (it is then in the recent languages) is kept. Runs at startup after the
 * upstream migrations; its own flag keeps it out of upstream's version numbering.
 */
export function migrateLangToAuto() {
	if (readConfig(LANG_AUTO_MIGRATED_KEY, false)) return
	// Runs before the first render: a hand-edited config must never stop the app from starting.
	try {
		const options = readConfig<unknown>(CONFIG_KEYS.modelOptions, null)
		const recent = readConfig<unknown>(CONFIG_KEYS.recentLanguages, [])
		const pickedEn = Array.isArray(recent) && recent.some((entry) => typeof entry === 'object' && entry !== null && (entry as { code?: unknown }).code === 'en')
		if (typeof options === 'object' && options !== null && (options as { lang?: unknown }).lang === 'en' && !pickedEn) {
			writeConfig(CONFIG_KEYS.modelOptions, { ...options, lang: 'auto' })
		}
	} catch (error) {
		console.error('tyto: language auto-detection migration skipped', error)
	}
	writeConfig(LANG_AUTO_MIGRATED_KEY, true)
}
