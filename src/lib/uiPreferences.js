const KEY = 'yp:ui-preferences'
export const defaultPreferences = { theme: 'light', reducedMotion: false, haptics: true }

export function readPreferences() {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) || '{}')
    return { theme: value.theme === 'dark' ? 'dark' : 'light', reducedMotion: value.reducedMotion === true, haptics: value.haptics !== false }
  } catch { return { ...defaultPreferences } }
}

export function applyPreferences(value) {
  document.documentElement.dataset.theme = value.theme
  document.documentElement.dataset.reduceMotion = String(value.reducedMotion)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value.theme === 'light' ? '#f2f4f6' : '#07090c')
  try { window.localStorage.setItem(KEY, JSON.stringify(value)) } catch { /* Display preferences still work for this visit. */ }
}

export function tactileFeedback(pattern = 12) {
  if (!readPreferences().haptics || typeof navigator.vibrate !== 'function') return
  try { navigator.vibrate(pattern) } catch { /* Feedback must never interrupt saving. */ }
}
