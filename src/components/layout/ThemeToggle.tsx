import { useTheme } from '@/lib/theme/use-theme'

/** Botón de cambio de tema claro/oscuro (persistente). */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      aria-pressed={isDark}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-input bg-surface text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" aria-hidden>
          <circle cx="12" cy="12" r="4" strokeWidth="1.6" />
          <path
            strokeWidth="1.6"
            strokeLinecap="round"
            d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" aria-hidden>
          <path
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
          />
        </svg>
      )}
    </button>
  )
}
