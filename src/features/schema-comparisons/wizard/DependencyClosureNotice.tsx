import { useState } from 'react'
import {
  type BadgeTone,
  Badge,
  CodeBlock,
  ErrorState,
  EyeIcon,
  EyeOffIcon,
  IconButton,
  Spinner,
} from '@/components/ui'
import type { SchemaChangeType, SchemaComparisonItemOut } from '@/lib/contracts'
import { CHANGE_TYPE_LABELS, OBJECT_TYPE_LABELS, opGroupObjectNames } from './logic'
import type { useResolveComparisonSelection } from '../hooks/use-schema-comparisons'

const CHANGE_TONE: Record<SchemaChangeType, BadgeTone> = {
  new: 'success',
  modified: 'warning',
  dropped: 'error',
}

/**
 * Resultado del cierre de dependencias (`POST .../resolve-selection`, §10.6) en los pasos de
 * confirmación: si el backend agregó sentencias porque la selección dependía de ellas, se
 * muestran ANTES de confirmar (objeto, tipo de cambio, SQL colapsable y quién las requiere, vía
 * `added_reasons`). La selección final que viaja a adopt/execute son los `resolved_item_ids` —
 * por eso el submit queda bloqueado mientras este cierre no esté fresco.
 */
export function DependencyClosureNotice({
  resolve,
  items,
}: {
  resolve: ReturnType<typeof useResolveComparisonSelection>
  /** Ítems del diff, para traducir `op_group` → nombres de objeto legibles. */
  items: SchemaComparisonItemOut[]
}) {
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null)

  if (resolve.isError && !resolve.data) {
    return (
      <ErrorState
        error={resolve.error}
        onRetry={() => void resolve.refetch()}
        title="No se pudo cerrar las dependencias de la selección"
      />
    )
  }

  if (!resolve.data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cerrando dependencias de la selección…
      </div>
    )
  }

  const { added, added_item_ids, added_reasons, resolved_item_ids, total } = resolve.data
  const refreshing = resolve.isStale || resolve.isFetching

  /** "Requerida por" de un ítem agregado: `added_reasons` está indexado por `op_group`, así que
   * se resuelve el grupo del ítem con los ítems cargados y de ahí a los grupos que lo exigen. */
  const reasonFor = (itemId: number): string | null => {
    const item = items.find((candidate) => candidate.id === itemId)
    if (!item || item.op_group == null) return null
    const requiringGroups = added_reasons[item.op_group]
    if (!requiringGroups || requiringGroups.length === 0) return null
    const names: string[] = []
    for (const group of requiringGroups) {
      for (const name of opGroupObjectNames(items, group)) {
        if (!names.includes(name)) names.push(name)
      }
    }
    return names.join(', ')
  }

  if (added_item_ids.length === 0) {
    return (
      <p className="text-sm text-success">
        ✓ Tu selección cierra todas sus dependencias ({resolved_item_ids.length} sentencia(s), en
        orden de ejecución).{refreshing && ' ⏳ Actualizando…'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
      <p className="text-sm font-medium text-foreground">
        Se{' '}
        {added_item_ids.length === 1
          ? 'agregó 1 sentencia'
          : `agregaron ${added_item_ids.length} sentencia(s)`}{' '}
        porque tu selección depende de ellas
        {refreshing && (
          <span className="font-normal text-muted-foreground"> · ⏳ actualizando…</span>
        )}
      </p>
      <div className="flex flex-col gap-2">
        {added.map((addedItem) => {
          const isExpanded = expandedItemId === addedItem.item_id
          const reason = reasonFor(addedItem.item_id)
          return (
            <div
              key={addedItem.item_id}
              className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{OBJECT_TYPE_LABELS[addedItem.object_type]}</Badge>
                <Badge tone={CHANGE_TONE[addedItem.change_type]}>
                  {CHANGE_TYPE_LABELS[addedItem.change_type]}
                </Badge>
                <span className="truncate text-xs font-medium text-foreground">
                  {addedItem.object_name}
                </span>
                <code className="font-mono text-xs text-muted-foreground">
                  #{addedItem.item_id}
                </code>
                <IconButton
                  label={isExpanded ? 'Ocultar SQL' : 'Ver SQL'}
                  icon={isExpanded ? <EyeOffIcon /> : <EyeIcon />}
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  onClick={() => setExpandedItemId(isExpanded ? null : addedItem.item_id)}
                />
              </div>
              {reason && (
                <p className="text-xs text-muted-foreground">
                  Requerida por: <strong>{reason}</strong>
                </p>
              )}
              {isExpanded && <CodeBlock code={addedItem.sql} maxHeightClass="max-h-56" />}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Selección final: <strong>{total}</strong> sentencia(s), en orden de ejecución. Es lo que se
        enviará al confirmar.
      </p>
    </div>
  )
}
