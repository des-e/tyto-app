/** What the user picked in General settings: a fixed theme, or follow the system (design round 8). */
export type ThemeChoice = 'light' | 'dark' | 'system'

export const THEME_CHOICES: ThemeChoice[] = ['light', 'dark', 'system']

export function systemPrefersDark(): boolean {
	return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
}

/** The theme to draw with: «Как в системе» follows the OS, anything unknown falls back to it too. */
export function resolveTheme(choice: string | null | undefined, systemDark = systemPrefersDark()): 'light' | 'dark' {
	if (choice === 'light' || choice === 'dark') return choice
	return systemDark ? 'dark' : 'light'
}
