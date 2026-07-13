import type { SchemaComparisonCounts } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { compositionRows } from './logic'

/**
 * Composición del diff por tipo de objeto y tipo de cambio (Vista 2, `counts` del resumen):
 * barras horizontales apiladas (nuevo/modificado/eliminado), ordenadas por magnitud total
 * descendente. Misma técnica de "barra de div" que `ObjectCompositionChart` del asistente de
 * snapshot, pero con 3 segmentos por fila en vez de 1. Estática: una lectura por comparación.
 */
export function DiffCompositionChart({
  counts,
  className,
}: {
  counts: SchemaComparisonCounts
  className?: string
}) {
  const rows = compositionRows(counts)
  if (rows.length === 0) return null
  const max = rows.reduce((acc, row) => Math.max(acc, row.total), 0)

  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <div
        className="flex flex-col gap-1.5"
        role="img"
        aria-label="Composición del diff por tipo de objeto y tipo de cambio"
      >
        {rows.map((row) => (
          <div key={row.objectType} className="flex items-center gap-3 text-sm">
            <span className="w-36 shrink-0 truncate text-muted-foreground sm:w-44" title={row.label}>
              {row.label}
            </span>
            <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-surface-muted">
              {row.new > 0 && (
                <div
                  className="h-full bg-success"
                  style={{ width: `${(row.new / max) * 100}%` }}
                  title={`${row.new} nuevo(s)`}
                />
              )}
              {row.modified > 0 && (
                <div
                  className="h-full bg-warning"
                  style={{ width: `${(row.modified / max) * 100}%` }}
                  title={`${row.modified} modificado(s)`}
                />
              )}
              {row.dropped > 0 && (
                <div
                  className="h-full bg-error"
                  style={{ width: `${(row.dropped / max) * 100}%` }}
                  title={`${row.dropped} eliminado(s)`}
                />
              )}
            </div>
            <span className="w-8 shrink-0 text-right font-medium tabular-nums text-foreground">
              {row.total}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-success" aria-hidden /> Nuevo
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-warning" aria-hidden /> Modificado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-error" aria-hidden /> Eliminado
        </span>
      </figcaption>
    </figure>
  )
}
