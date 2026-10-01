import { useSyncExternalStore } from 'react'

/**
 * The staff app's look, chosen per device in Settings. "classic" is the original ink-on-paper design; "2100" is the
 * dark command-center theme. It is a per-device preference (a shared shop tablet and the owner's phone may want
 * different ones), so it lives in localStorage rather than on the account.
 *
 * public/theme-boot.js applies the stored value before the first paint, so the page never flashes the wrong background.
 * Keep the key in step with it.
 */
export const THEMES = ['classic', '2100'] as const
export type Theme = (typeof THEMES)[number]

const KEY = 'mpe.theme'
const THEME_COLOR: Record<Theme, string> = { classic: '#101418', '2100': '#090d16' }
const listeners = new Set<() => void>()

/** Storage can be unavailable (private mode, blocked site data): fall back to the classic look, never throw. */
export function storedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === '2100' ? '2100' : 'classic'
  } catch {
    return 'classic'
  }
}

function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'classic') delete root.dataset.theme
  else root.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'classic') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Not remembered on this device, but still applied for this visit.
  }
  apply(theme)
  for (const notify of listeners) notify()
}

const currentTheme = (): Theme => (document.documentElement.dataset.theme === '2100' ? '2100' : 'classic')

function subscribe(notify: () => void) {
  listeners.add(notify)
  return () => { listeners.delete(notify) }
}

/** The theme in effect right now; re-renders when it changes. */
export const useTheme = (): Theme => useSyncExternalStore(subscribe, currentTheme, () => 'classic')
