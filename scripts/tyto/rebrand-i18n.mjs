// Rebrands upstream UI strings: "Vibe" -> "Tyto" in every i18n/desktop/*.json value, and keeps the
// credit line `basedOnVibe` in place. Idempotent; run again after every merge from upstream.
//   node scripts/tyto/rebrand-i18n.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../i18n/desktop')
const credit = {
	'ru-RU': 'Основано на Vibe (MIT) — спасибо автору',
	'en-US': 'Based on Vibe (MIT) — thanks to its author',
}
const CREDIT_KEY = 'basedOnVibe'

let changed = 0
for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
	const locale = file.replace(/\.json$/, '')
	const path = resolve(dir, file)
	const raw = readFileSync(path, 'utf-8')
	const messages = JSON.parse(raw)
	for (const [key, value] of Object.entries(messages)) {
		if (key === CREDIT_KEY || typeof value !== 'string') continue
		messages[key] = value.replace(/\bVibe\b/g, 'Tyto')
	}
	if (credit[locale]) messages[CREDIT_KEY] = credit[locale]
	// Match the upstream files: tab indent, trailing newline kept as found.
	const next = JSON.stringify(messages, null, '\t') + (raw.endsWith('\n') ? '\n' : '')
	if (next !== raw) {
		writeFileSync(path, next)
		changed++
	}
}
console.log(`rebrand-i18n: ${changed} file(s) updated`)
