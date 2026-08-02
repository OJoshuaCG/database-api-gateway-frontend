import { useId } from 'react'
import { cn } from '@/lib/utils'
import { useSqlTheme } from '@/lib/theme/use-sql-theme'
import { isSqlTheme, SQL_THEMES } from '@/lib/theme/sql-theme-context'

/**
 * Selector de la paleta de resaltado de SQL. La preferencia es global: cambia a la vez todos los
 * bloques de código de la app, así que se ofrece en un solo control en vez de uno por bloque.
 *
 * Cada paleta trae su variante clara y su variante oscura, de modo que la elección es
 * independiente del tema de la app y no hay combinación que quede ilegible.
 */
export function SqlThemeSelect({
  className,
  hideLabel,
}: {
  className?: string
  /** En barras compactas la etiqueta visible sobra; el nombre accesible se conserva igual. */
  hideLabel?: boolean
}) {
  const { sqlTheme, setSqlTheme } = useSqlTheme()
  const id = useId()

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label htmlFor={id} className={cn('text-xs text-muted-foreground', hideLabel && 'sr-only')}>
        Tema del SQL
      </label>
      <select
        id={id}
        value={sqlTheme}
        onChange={(event) => {
          if (isSqlTheme(event.target.value)) setSqlTheme(event.target.value)
        }}
        className="rounded-lg border border-input bg-surface px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {SQL_THEMES.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.label}
          </option>
        ))}
      </select>
    </div>
  )
}
