import { Fragment, useState } from 'react'
import {
  Badge,
  Checkbox,
  ChevronRightIcon,
  EmptyState,
  ErrorState,
  IconButton,
  RefreshIcon,
  Spinner,
  Switch,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { useCountdown } from '@/lib/utils/use-countdown'
import type {
  CollationColumnOut,
  CollationGroupOut,
  CollationInventoryOut,
  CollationObjectOut,
  CollationTableOut,
  EngineType,
  FrozenObjectType,
} from '@/lib/contracts'
import { isFrozenObjectType, objectKey } from '../logic'
import type { CollationConversionWizard } from '../use-collation-conversion-wizard'

/**
 * Paso 2 del asistente de conversión de collation: inventario del motor + selección de qué
 * convertir. El hook YA preselecciona tablas/objetos desactualizados la primera vez que llega el
 * inventario de un job (§9.1) — este componente solo refleja `checkedTables`/`checkedObjects`,
 * nunca reimplementa esa lógica.
 */

/** Traducción del motor a la etiqueta que ve el operador — nunca el string crudo del contrato. */
const ENGINE_LABELS: Record<EngineType, string> = {
  mysql: 'MySQL / MariaDB',
  mariadb: 'MySQL / MariaDB',
  postgresql: 'PostgreSQL',
}

const FROZEN_TYPE_LABELS: Record<FrozenObjectType, string> = {
  procedure: 'Procedimiento',
  function: 'Función',
  trigger: 'Trigger',
  event: 'Evento',
  view: 'Vista',
}

/**
 * `useCountdown` (compartido con `sql-console`/`server-databases`) calcula el resto en ms a partir
 * de `expires_at` con el margen por desfase de reloj ya aplicado. Se formatea distinto de
 * `formatCountdown` porque la vigencia de un plan de conversión se mide en horas, no en segundos
 * como el `confirm_token` de esas pantallas — un "mm:ss" ahí no comunicaría nada útil.
 */
function formatHoursMinutes(ms: number): string {
  if (ms <= 0) return 'vencido'
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`
}

/**
 * Etiqueta "charset · collation" de un grupo del resumen. En modo `columns` (PostgreSQL) `charset`
 * siempre es `null` y se muestra solo la collation — nunca "sin collation": ausencia de collation
 * explícita significa que el grupo hereda la de la base, no que carezca de una.
 */
function formatGroupCombo(group: CollationGroupOut): string {
  if (group.charset === null) return group.collation ?? 'heredada de la base'
  return group.collation !== null ? `${group.charset} · ${group.collation}` : group.charset
}

/** Angosta `CollationObjectOut.object_type` (string suelto del contrato) a los 5 tipos congelados. */
function isFrozenObject(
  object: CollationObjectOut,
): object is CollationObjectOut & { object_type: FrozenObjectType } {
  return isFrozenObjectType(object.object_type)
}

export function InventoryStep({ wizard }: { wizard: CollationConversionWizard }) {
  const { objects, job } = wizard
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set())
  const remainingExpiryMs = useCountdown(job.data?.expires_at ?? null)

  const toggleExpand = (name: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const renderSummary = (data: CollationInventoryOut) => (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Resumen por combinación
      </p>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-3 py-2 font-semibold">Charset / collation</th>
              <th className="px-3 py-2 font-semibold">Tablas</th>
              {data.mode === 'columns' && <th className="px-3 py-2 font-semibold">Columnas</th>}
            </tr>
          </thead>
          <tbody>
            {data.summary.map((group, index) => (
              <tr key={index} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-foreground">{formatGroupCombo(group)}</td>
                <td className="px-3 py-2 text-muted-foreground">{group.table_count}</td>
                {data.mode === 'columns' && (
                  <td className="px-3 py-2 text-muted-foreground">{group.column_count ?? '—'}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  const renderNotes = (notes: readonly string[]) => {
    if (notes.length === 0) return null
    return (
      <details className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-foreground">
          Alcance de esta conversión
        </summary>
        <div className="mt-2 flex flex-col gap-1.5">
          {notes.map((note, index) => (
            <p key={index}>{note}</p>
          ))}
        </div>
      </details>
    )
  }

  const renderWarnings = (warnings: readonly string[]) => {
    if (warnings.length === 0) return null
    return (
      <div className="flex flex-col gap-2">
        {warnings.map((warning, index) => (
          <div
            key={index}
            className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground"
          >
            {warning}
          </div>
        ))}
      </div>
    )
  }

  const renderUniversalTables = (tables: readonly CollationTableOut[]) => {
    if (tables.length === 0) {
      return <EmptyState title="Sin tablas" description="Esta base no tiene tablas registradas." />
    }
    return (
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-3 py-2 font-semibold">Tabla</th>
              <th className="px-3 py-2 font-semibold">Charset / collation</th>
              <th className="px-3 py-2 font-semibold">Columnas con discrepancia</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((table) => (
              <tr key={table.name} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <Checkbox
                    label={table.name}
                    checked={wizard.checkedTables.has(table.name)}
                    onChange={() => wizard.toggleTable(table.name)}
                  />
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {table.charset ?? '—'} · {table.collation ?? '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{table.mismatched_columns}</td>
                <td className="px-3 py-2">
                  {!table.needs_conversion && <Badge tone="success">✓ al día</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const renderFrozenObjects = (allObjects: readonly CollationObjectOut[]) => {
    const frozenObjects = allObjects.filter(isFrozenObject)
    if (frozenObjects.length === 0) return null
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Objetos programables congelados
        </p>
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
          Estos objetos guardan la collation con la que fueron creados. Si no se recrean, seguirán
          comparando texto en la collation vieja y producirán errores en producción.
        </div>
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Objeto</th>
                <th className="px-3 py-2 font-semibold">Tipo</th>
                <th className="px-3 py-2 font-semibold">Conexión</th>
                <th className="px-3 py-2 font-semibold">Base de datos</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {frozenObjects.map((object) => {
                const ref = { object_type: object.object_type, name: object.name }
                const key = objectKey(ref)
                const isChecked = wizard.checkedObjects.has(key)
                const showStaleWarning = object.is_outdated && !isChecked
                return (
                  <tr key={key} className="border-b border-border align-top last:border-0">
                    <td className="px-3 py-2">
                      <Checkbox
                        label={object.name}
                        checked={isChecked}
                        onChange={() => wizard.toggleObject(ref)}
                      />
                      {showStaleWarning && (
                        <p className="mt-1 max-w-xs text-xs text-warning">
                          Sigue con la collation vieja: es exactamente el caso que esta herramienta
                          existe para evitar.
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {FROZEN_TYPE_LABELS[object.object_type]}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {object.collation_connection ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {object.object_type === 'view' ? '—' : (object.database_collation ?? '—')}
                    </td>
                    <td className="px-3 py-2">
                      {object.is_outdated && <Badge tone="warning">desactualizado</Badge>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const renderColumnDetail = (columns: readonly CollationColumnOut[]) => (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="px-3 py-1.5 font-semibold">Columna</th>
          <th className="px-3 py-1.5 font-semibold">Tipo de dato</th>
          <th className="px-3 py-1.5 font-semibold">Collation actual</th>
          <th className="px-3 py-1.5 font-semibold">Estado</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((column) => (
          <tr key={column.name} className="border-b border-border bg-surface last:border-0">
            <td className="px-3 py-1.5 font-mono text-xs text-foreground">{column.name}</td>
            <td className="px-3 py-1.5 text-muted-foreground">{column.data_type}</td>
            <td className="px-3 py-1.5 text-muted-foreground">
              {column.current_collation ?? 'heredada de la base'}
            </td>
            <td className="px-3 py-1.5">
              {column.is_default_collation ? (
                <Badge tone="warning">pendiente</Badge>
              ) : (
                <Badge tone="success">✓ al día</Badge>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  const renderColumnsTables = (tables: readonly CollationTableOut[]) => {
    if (tables.length === 0) {
      return <EmptyState title="Sin tablas" description="Esta base no tiene tablas registradas." />
    }
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          La selección es por TABLA. Todas las columnas pendientes de una tabla se convierten
          juntas, en una sola operación.
        </p>
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Tabla</th>
                <th className="px-3 py-2" />
                <th className="px-3 py-2 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((table) => {
                const isExpanded = expandedTables.has(table.name)
                return (
                  <Fragment key={table.name}>
                    <tr className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <Checkbox
                          label={table.name}
                          checked={wizard.checkedTables.has(table.name)}
                          onChange={() => wizard.toggleTable(table.name)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <IconButton
                          label={isExpanded ? 'Ocultar columnas' : 'Ver columnas'}
                          icon={
                            <ChevronRightIcon
                              className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')}
                            />
                          }
                          variant="ghost"
                          onClick={() => toggleExpand(table.name)}
                          aria-expanded={isExpanded}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {!table.needs_conversion && <Badge tone="success">✓ al día</Badge>}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-border bg-surface-muted/40 last:border-0">
                        <td colSpan={3} className="px-3 py-3">
                          {table.columns && table.columns.length > 0 ? (
                            renderColumnDetail(table.columns)
                          ) : (
                            <p className="text-xs text-muted-foreground">Sin columnas.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{wizard.database}</h2>
            <Badge tone="neutral">{ENGINE_LABELS[wizard.engine]}</Badge>
          </div>
          <IconButton
            label="Recargar inventario"
            icon={<RefreshIcon />}
            variant="ghost"
            onClick={() => wizard.reloadInventory()}
            isLoading={objects.isFetching}
          />
        </div>
        {objects.data && (
          <p className="text-sm text-muted-foreground">
            {objects.data.db_charset ?? '—'} · {objects.data.db_collation ?? '—'} →{' '}
            {objects.data.target_charset ? `${objects.data.target_charset} · ` : ''}
            {objects.data.target_collation}
          </p>
        )}
        {job.data && (
          <p className="text-xs text-muted-foreground">
            El plan vence en {formatHoursMinutes(remainingExpiryMs)}
          </p>
        )}
      </div>

      {objects.isLoading && !objects.data && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Spinner /> Cargando el inventario…
        </div>
      )}

      {objects.isError && !objects.data && (
        <ErrorState error={objects.error} onRetry={() => wizard.reloadInventory()} />
      )}

      {objects.data && (
        <>
          {renderSummary(objects.data)}
          {renderNotes(objects.data.notes)}
          {renderWarnings(objects.data.warnings)}

          {wizard.mode === 'universal' ? (
            <>
              {renderUniversalTables(objects.data.tables)}
              {renderFrozenObjects(objects.data.objects)}
              <Switch
                checked={wizard.includeDatabaseDefault}
                onCheckedChange={wizard.setIncludeDatabaseDefault}
                label="Cambiar también el juego de caracteres por defecto de la base"
                hint="Afecta a los objetos que se creen DESPUÉS. No modifica las tablas existentes."
              />
            </>
          ) : (
            renderColumnsTables(objects.data.tables)
          )}
        </>
      )}
    </div>
  )
}
