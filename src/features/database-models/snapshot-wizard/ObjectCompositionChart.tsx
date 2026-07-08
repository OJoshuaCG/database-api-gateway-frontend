import { NON_PORTABLE_OBJECT_TYPES, type DumpObjectType } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { OBJECT_TYPE_LABELS, TYPE_ORDER } from './logic'

/**
 * Composición de objetos del snapshot (Plan 09 §6): barras horizontales ordenadas por magnitud.
 * Una sola medida (conteo) sobre categorías nominales → hue único; los tipos procedurales
 * (no portables) se distinguen con color de estado `warning` + leyenda (codificación secundaria,
 * no solo color). Estática: una lectura por snapshot.
 */
export function ObjectCompositionChart({
  counts,
  className,
}: {
  counts: Partial<Record<DumpObjectType, number>>
  className?: string
}) {
  const rows = TYPE_ORDER.map((type) => ({
    type,
    label: OBJECT_TYPE_LABELS[type],
    value: counts[type] ?? 0,
    nonPortable: NON_PORTABLE_OBJECT_TYPES.has(type),
  }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)

  const max = rows.reduce((acc, row) => Math.max(acc, row.value), 0)
  if (rows.length === 0) return null
  const anyNonPortable = rows.some((row) => row.nonPortable)

  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-col gap-1.5" role="img" aria-label="Composición de objetos por tipo">
        {rows.map((row) => (
          <div key={row.type} className="flex items-center gap-3 text-sm">
            <span className="w-40 shrink-0 truncate text-muted-foreground" title={row.label}>
              {row.label}
            </span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-muted">
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full',
                  row.nonPortable ? 'bg-warning' : 'bg-primary',
                )}
                style={{ width: `${Math.max((row.value / max) * 100, 4)}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-medium tabular-nums text-foreground">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {anyNonPortable && (
        <figcaption className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden /> Portable
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-warning" aria-hidden /> No portable
            (atado al motor)
          </span>
        </figcaption>
      )}
    </figure>
  )
}
