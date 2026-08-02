import { createContext } from 'react'

/**
 * Paletas de resaltado de SQL. Los valores viven en `styles/syntax-themes.css`; aquí solo está
 * el catálogo que ve el usuario, para que el selector y el CSS no se desincronicen.
 */
export const SQL_THEMES = [
  { id: 'vscode', label: 'VS Code' },
  { id: 'catppuccin', label: 'Catppuccin' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'github', label: 'GitHub' },
  { id: 'hack-the-box', label: 'Hack The Box' },
] as const

export type SqlTheme = (typeof SQL_THEMES)[number]['id']

export const DEFAULT_SQL_THEME: SqlTheme = 'vscode'

export function isSqlTheme(value: string | null | undefined): value is SqlTheme {
  return SQL_THEMES.some((theme) => theme.id === value)
}

export interface SqlThemeContextValue {
  sqlTheme: SqlTheme
  setSqlTheme: (theme: SqlTheme) => void
}

export const SqlThemeContext = createContext<SqlThemeContextValue | null>(null)

export const SQL_THEME_STORAGE_KEY = 'gw-sql-theme'
