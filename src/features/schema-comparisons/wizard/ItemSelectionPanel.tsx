import { useMemo, useState } from 'react'
import { type BadgeTone, Badge, Button, Checkbox, EmptyState, ErrorState, Spinner } from '@/components/ui'
import type { EngineType, SchemaChangeType } from '@/lib/contracts'
import { CHANGE_TYPE_LABELS, groupItemsByObjectName, hasMysqlProceduralRisk, OBJECT_TYPE_LABELS, type SelectionShortcut } from './logic'
import { RiskFlagsBadgeRow } from './RiskFlagsBadgeRow'
import { SqlStatementViewer } from './SqlStatementViewer'
import type { useAllSchemaComparisonItems } from '../hooks/use-schema-comparisons'

const CHANGE_TONE: Record<SchemaChangeType, BadgeTone> = {
  new: 'success',
  modified: 'warning',
  dropped: 'error',
}

interface ItemSelectionPanelProps {
  itemsQuery: ReturnType<typeof useAllSchemaComparisonItems>
  selectedItemIds: Set<number>
  reviewedItemIds: Set<number>
  onToggle: (id: number) => void
  onMarkReviewed: (id: number) => void
  onApplyShortcut: (shortcut: SelectionShortcut) => void
  targetEngine?: EngineType
  /** `false` en Opción A (adopt): esa vía no tiene modos masivos, solo selección explícita. */
  supportsBulkModes?: boolean
}

/**
 * Tabla de selección compartida entre Opción A (Vista 4a) y Opción B en modo `custom` (Vista
 * 5a): checkboxes por ítem (independientes de la paginación server-side — operan sobre el
 * conjunto COMPLETO ya cargado por `useAllSchemaComparisonItems`), atajos de selección, gate de
 * "revisión individual" para objetos procedurales, y el aviso de la limitación conocida v1 de
 * adoptar procedurales MySQL/MariaDB. Un mismo componente para ambas rutas evita inconsistencias.
 */
export function ItemSelectionPanel({
  itemsQuery,
  selectedItemIds,
  reviewedItemIds,
  onToggle,
  onMarkReviewed,
  onApplyShortcut,
  targetEngine,
  supportsBulkModes = true,
}: ItemSelectionPanelProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Se derivan ANTES de cualquier `return` condicional (reglas de hooks): con la lista vacía en
  // los renders de carga/error, la memoización no aporta pero tampoco cuesta nada relevante; una
  // vez `itemsQuery.data` está poblado, `items` mantiene la misma referencia entre renders no
  // relacionados (expandir una fila, tipear en otro campo del wizard), así que ambos `useMemo`
  // dejan de recalcularse en cada tecla — antes se re-escaneaba el array completo en cada render.
  const items = itemsQuery.data?.items ?? []
  const groups = useMemo(() => groupItemsByObjectName(items), [items])
  const proceduralRisk = useMemo(
    () => hasMysqlProceduralRisk(items, selectedItemIds, targetEngine),
    [items, selectedItemIds, targetEngine],
  )

  if (itemsQuery.isLoading && !itemsQuery.data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando ítems del diff…
      </div>
    )
  }
  if (itemsQuery.isError && !itemsQuery.data) {
    return (
      <ErrorState
        error={itemsQuery.error}
        onRetry={() => void itemsQuery.refetch()}
        title="No se pudieron cargar los ítems"
      />
    )
  }
  if (!itemsQuery.data) return null

  const { truncated } = itemsQuery.data
  if (items.length === 0) {
    return (
      <EmptyState
        title="Sin ítems para seleccionar"
        description="Esta comparación no tiene ítems."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onApplyShortcut('all')}>
          Seleccionar todo
        </Button>
        <Button variant="outline" size="sm" onClick={() => onApplyShortcut('safeAdditive')}>
          Solo aditivos seguros
        </Button>
        <Button variant="outline" size="sm" onClick={() => onApplyShortcut('none')}>
          Ninguno
        </Button>
        <span className="text-sm text-muted-foreground">
          Seleccionados: {selectedItemIds.size} de {items.length}
        </span>
      </div>

      {truncated && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
          El diff es muy grande: se cargaron los primeros {items.length} ítems para seleccionar.{' '}
          {supportsBulkModes
            ? 'Si necesitas cubrir el resto, usa un modo masivo (todo / todo excepto destructivo) en vez de la selección personalizada.'
            : 'Esta versión del blueprint solo incluirá los ítems cargados aquí; si necesitas cubrir el resto, adóptalo en varias versiones sucesivas.'}
        </p>
      )}

      {proceduralRisk && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
          ⚠ Seleccionaste rutinas/triggers de MySQL/MariaDB. Adoptarlas como versión de blueprint
          puede fallar al aplicarse (el separador de sentencias corta mal el <code>BEGIN…END</code>
          ). Considera ejecutarlas directo (Opción B) o edita el SQL de la versión antes de
          aplicarla.
        </p>
      )}

      <div className="flex max-h-[28rem] flex-col gap-3 overflow-auto rounded-lg border border-border p-3">
        {groups.map((group) => (
          <div key={group.objectName} className="flex flex-col gap-1.5">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.objectName}
            </p>
            {group.items.map((item) => {
              const isExpanded = expandedId === item.id
              const requiresReview = item.risk_flags.requires_individual_review
              const isReviewed = reviewedItemIds.has(item.id)
              const checked = selectedItemIds.has(item.id)
              const checkboxDisabled = requiresReview && !isReviewed

              return (
                <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Checkbox
                      label={`${OBJECT_TYPE_LABELS[item.object_type]} · ${item.object_name}`}
                      checked={checked}
                      disabled={checkboxDisabled}
                      onChange={() => onToggle(item.id)}
                    />
                    <Badge tone={CHANGE_TONE[item.change_type]}>{CHANGE_TYPE_LABELS[item.change_type]}</Badge>
                    <code className="font-mono text-xs text-muted-foreground">#{item.id}</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    >
                      {isExpanded ? 'Ocultar SQL' : 'Ver SQL'}
                    </Button>
                  </div>
                  <RiskFlagsBadgeRow riskFlags={item.risk_flags} className="pl-7" />
                  {requiresReview && !isReviewed && (
                    <p className="pl-7 text-xs text-muted-foreground">
                      Objeto procedural: abre el SQL completo para poder seleccionarlo.
                    </p>
                  )}
                  {isExpanded && (
                    <div className="flex flex-col gap-2 pl-7">
                      <SqlStatementViewer item={item} />
                      {requiresReview && !isReviewed && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="self-start"
                          onClick={() => onMarkReviewed(item.id)}
                        >
                          Marcar como revisado
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
