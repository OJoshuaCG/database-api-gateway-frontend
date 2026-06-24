import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ThemeContext, THEME_STORAGE_KEY, type Theme } from './theme-context'

function readInitialTheme(): Theme {
  // El script anti-FOUC de index.html ya resolvió el tema en <html data-theme>.
  const current = document.documentElement.dataset.theme
  return current === 'dark' ? 'dark' : 'light'
}

/**
 * Proveedor de tema. Persiste la preferencia (light/dark) en localStorage. Solo se
 * guarda la preferencia de tema — NO datos sensibles ni tokens (la sesión es una cookie
 * httpOnly invisible al JS).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      /* almacenamiento no disponible: el tema sigue funcionando en memoria. */
    }
  }, [theme])

  const setTheme = useCallback((next: Theme) => setThemeState(next), [])
  const toggleTheme = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
