import { useEffect } from 'react'
import { getTextDirection } from '~/paraglide/runtime.js'

/**
 * Publishes half the sidebar width as `--tyto-main-x` on <html>, so things centred on the window
 * (toasts, theme.css) can centre on the main area instead. The sidebar sits on the right in RTL,
 * hence the sign. Removed when the sidebar unmounts.
 */
export function useMainAreaOffset(sidebarWidth: number) {
	useEffect(() => {
		const sign = getTextDirection() === 'rtl' ? -1 : 1
		const root = document.documentElement
		root.style.setProperty('--tyto-main-x', `${(sign * sidebarWidth) / 2}px`)
		return () => {
			root.style.removeProperty('--tyto-main-x')
		}
	}, [sidebarWidth])
}
