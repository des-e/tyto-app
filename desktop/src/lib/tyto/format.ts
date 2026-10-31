import { m } from '~/paraglide/messages.js'

/** «48 мин», «1 ч 12 мин», «35 с»: length of a recording (export dialog header, sidebar meta). */
export function durationLabel(totalSeconds: number) {
	const seconds = Math.max(0, Math.round(totalSeconds))
	if (seconds < 60) return m.durationSeconds({ seconds: String(seconds) })
	const totalMinutes = Math.round(seconds / 60)
	const hours = Math.floor(totalMinutes / 60)
	const minutes = totalMinutes % 60
	if (hours === 0) return m.durationMinutes({ minutes: String(minutes) })
	if (minutes === 0) return m.durationHours({ hours: String(hours) })
	return m.durationHoursMinutes({ hours: String(hours), minutes: String(minutes) })
}

/**
 * Size of a download in megabytes (decimal units): «18 из 43 МБ». One decimal only while the whole
 * file is under 10 МБ; without a known total only what has arrived: «Скачано 18 МБ».
 */
export function downloadSizeLabel(downloaded: number, total: number | null, locale: string) {
	const digits = total !== null && total < 10e6 ? 1 : 0
	const mb = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
	if (total === null) return m.updateWindowDownloaded({ size: mb.format(downloaded / 1e6) })
	return m.setupSizeMb({ current: mb.format(downloaded / 1e6), total: mb.format(total / 1e6) })
}
