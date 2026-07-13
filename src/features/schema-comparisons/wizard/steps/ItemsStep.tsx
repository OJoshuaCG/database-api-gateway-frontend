import { useState } from 'react'
import { Badge, EmptyState, ErrorState, Pagination, Spinner } from '@/components/ui'
import { schemaChangeTypeSchema, schemaObjectTypeSchema, type SchemaChangeType, type SchemaObjectType } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { CHANGE_TYPE_LABELS, groupItemsByObjectName, OBJECT_TYPE_LABELS } from '../logic'
import { RiskFlagsBadgeRow } from '../RiskFlagsBadgeRow'
import { SqlStatementViewer } from '../SqlStatementViewer'
import type { SchemaComparisonWizard } from '../use-schema-comparison-wizard'

const CHANGE_TONE = { new: 'success', modified: 'warning', dropped: 'error' } as const

/** Vista 3 — detalle paginado del diff con el DDL exacto por ítem, agrupado por `object_name`. */
export function ItemsStep({ wizard }: { wizard: SchemaComparisonWizard }) {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const { items } = wizard

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Detalle del DDL</h2>
        <p className="text-sm text-muted-foreground">
          El DDL exacto que se ejecutaría en el target, ítem por ítem, con sus banderas de riesgo.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">Tipo de objeto</span>
          <select
            value={wizard.itemsObjectType ?? ''}
            onChange={(e) =>
              wizard.setItemsObjectType((e.target.value || null) as SchemaObjectType | null)
            }
            className="h-10 rounded-lg border border-input bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Todos</option>
            {schemaObjectTypeSchema.options.map((type) => (
              <option key={type} value={type}>
                {OBJECT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">Tipo de cambio</span>
          <select
            value={wizard.itemsChangeType ?? ''}
            onChange={(e) =>
              wizard.setItemsChangeType((e.target.value || null) as SchemaChangeType | null)
            }
            className="h-10 rounded-lg border border-input bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Todos</option>
            {schemaChangeTypeSchema.options.map((type) => (
              <option key={type} value={type}>
                {CHANGE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {items.isLoading && !items.data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Cargando ítems…
        </div>
      ) : items.isError && !items.data ? (
        <ErrorState error={items.error} onRetry={() => void items.refetch()} title="No se pudieron cargar los ítems" />
      ) : !items.data ? null : items.data.items.length === 0 ? (
        <EmptyState title="Ningún ítem coincide" description="Ajusta los filtros para ver otros resultados." />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {groupItemsByObjectName(items.data.items).map((group) => (
              <div key={group.objectName} className="flex flex-col gap-1.5">
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.objectName}
                </p>
                {group.items.map((item) => {
                  const isExpanded = expandedId === item.id
                  return (
                    <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        className="flex flex-wrap items-center gap-2 text-left"
                      >
                        <Badge tone="neutral">{OBJECT_TYPE_LABELS[item.object_type]}</Badge>
                        <Badge tone={CHANGE_TONE[item.change_type]}>{CHANGE_TYPE_LABELS[item.change_type]}</Badge>
                        <code className="font-mono text-xs text-muted-foreground">#{item.id}</code>
                        <span
                          className={cn(
                            'ml-auto text-sm font-medium text-primary',
                            isExpanded && 'underline',
                          )}
                        >
                          {isExpanded ? 'Ocultar SQL' : 'Ver SQL'}
                        </span>
                      </button>
                      <RiskFlagsBadgeRow riskFlags={item.risk_flags} />
                      {isExpanded && <SqlStatementViewer item={item} />}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {items.data.pagination.pages > 1 && (
            <Pagination
              page={items.data.pagination.page}
              pages={items.data.pagination.pages}
              total={items.data.pagination.total}
              size={items.data.pagination.size}
              hasNext={items.data.pagination.has_next}
              hasPrev={items.data.pagination.has_prev}
              onPageChange={wizard.setItemsPage}
              onSizeChange={wizard.setItemsSize}
              isFetching={items.isFetching}
            />
          )}
        </>
      )}
    </div>
  )
}
