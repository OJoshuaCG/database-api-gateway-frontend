import { useContext } from 'react'
import { SqlThemeContext } from './sql-theme-context'

export function useSqlTheme() {
  const ctx = useContext(SqlThemeContext)
  if (!ctx) throw new Error('useSqlTheme debe usarse dentro de <SqlThemeProvider>.')
  return ctx
}
