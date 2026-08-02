import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  DEFAULT_SQL_THEME,
  isSqlTheme,
  SqlThemeContext,
  SQL_THEME_STORAGE_KEY,
  type SqlTheme,
} from './sql-theme-context'

function readInitialSqlTheme(): SqlTheme {
  try {
    const stored = localStorage.getItem(SQL_THEME_STORAGE_KEY)
    if (isSqlTheme(stored)) return stored
  } catch {
    /* almacenamiento no disponible: se usa la paleta por omisión. */
  }
  return DEFAULT_SQL_THEME
}

/**
 * Paleta de resaltado de SQL, persistida como preferencia del usuario.
 *
 * Solo escribe `data-sql-theme` en `<html>`: el cambio de colores lo hace el CSS
 * (`styles/syntax-themes.css`), que redefine las variables `--syntax-*`. Por eso cambiar de
 * paleta no re-renderiza ningún bloque de código ni obliga a que los componentes conozcan el
 * tema — es la misma mecánica que el claro/oscuro de la app.
 *
 * A diferencia del tema de la app no hay script anti-FOUC en `index.html`: un destello de
 * paleta en un bloque de SQL no justifica bloquear el primer pintado.
 */
export function SqlThemeProvider({ children }: { children: ReactNode }) {
  const [sqlTheme, setSqlThemeState] = useState<SqlTheme>(readInitialSqlTheme)

  useEffect(() => {
    document.documentElement.dataset.sqlTheme = sqlTheme
    try {
      localStorage.setItem(SQL_THEME_STORAGE_KEY, sqlTheme)
    } catch {
      /* almacenamiento no disponible: la paleta sigue funcionando en memoria. */
    }
  }, [sqlTheme])

  const setSqlTheme = useCallback((next: SqlTheme) => setSqlThemeState(next), [])

  return (
    <SqlThemeContext.Provider value={{ sqlTheme, setSqlTheme }}>
      {children}
    </SqlThemeContext.Provider>
  )
}
