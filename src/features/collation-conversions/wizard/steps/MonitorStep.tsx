import { useState } from 'react'
import { Badge, Button, ErrorState, Modal, Pagination, Spinner } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { CollationConversionItemOut, CollationJobPhase } from '@/lib/contracts'
import {
  isDropWithoutCreateFailure,
  isFailedGrantsSkip,
  isSingleDatabaseAlterFailure,
} from '../logic'
import type { CollationConversionWizard } from '../use-collation-conversion-wizard'

const UNIVERSAL_PHASES: CollationJobPhase[] = ['database', 'tables', 'objects', 'done']
const COLUMNS_PHASES: CollationJobPhase[] = ['tables', 'done']

const PHASE_LABELS: Record<CollationJobPhase, string> = {
  database: 'Base de datos',
  tables: 'Tablas',
  objects: 'Objetos',
  done: 'Listo',
}

const OBJECT_TYPE_LABELS: Record<string, string> = {
  database: 'Base de datos',
  table: 'Tabla',
  procedure: 'Procedimiento',
  function: 'Función',
  trigger: 'Trigger',
  event: 'Evento',
  view: 'Vista',
}

function objectTypeLabel(objectType: string): string {
  return OBJECT_TYPE_LABELS[objectType] ?? objectType
}

/** Barra de pastillas de fase, adaptada al patrón de `database-clones/wizard/steps/MonitorStep`. */
function PhaseBar({
  mode,
  phase,
}: {
  mode: 'universal' | 'columns'
  phase: CollationJobPhase | null
}) {
  const order = mode === 'universal' ? UNIVERSAL_PHASES : COLUMNS_PHASES
  const currentIndex = phase ? order.indexOf(phase) : -1
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {order.map((step, index) => (
        <li
          key={step}
          className={cn(
            'rounded-full border px-3 py-1 font-medium',
            index === currentIndex
              ? 'border-primary bg-primary/10 text-primary'
              : index < currentIndex
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border text-muted-foreground',
          )}
        >
          {PHASE_LABELS[step]}
        </li>
      ))}
    </ol>
  )
}

/** Formatea `execution_ms`: por debajo de 1s en ms, de ahí en adelante en segundos con un decimal. */
function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function ItemStatusCell({ item }: { item: CollationConversionItemOut }) {
  const status = item.status ?? 'pending'

  if (status === 'ok') {
    return <Badge tone="success">✅ Correcto</Badge>
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col gap-1.5">
        <Badge tone="error">❌ Error</Badge>
        {item.error && (
          <p className="whitespace-pre-wrap rounded-md border border-error/30 bg-error/5 p-2 text-xs text-error">
            {item.error}
          </p>
        )}
      </div>
    )
  }

  if (status === 'skipped') {
    if (isFailedGrantsSkip(item)) {
      return (
        <div className="flex flex-col gap-1.5">
          <Badge tone="warning">⚠ Sigue con la collation vieja</Badge>
          <p className="text-xs font-medium text-warning">
            {item.object_name} NO se convirtió: sigue con la collation vieja.
          </p>
          {item.grants_error && (
            <p className="whitespace-pre-wrap rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
              {item.grants_error}
            </p>
          )}
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-1">
        <Badge tone="neutral">Salteado</Badge>
        {item.error && <p className="text-xs text-muted-foreground">{item.error}</p>}
      </div>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Spinner className="h-3.5 w-3.5" /> {item.status === null ? 'pendiente' : 'en curso'}
    </span>
  )
}

/**
 * Paso 4 — progreso y resultado. Sigue el job por polling de `GET /{id}` (fases, estado terminal)
 * y el detalle de pasos por `GET /{id}/items` (paginado, también con polling mientras no termine).
 * `WizardNav` devuelve `null` para este paso: todos los CTAs contextuales (cancelar, reintentar,
 * empezar de nuevo) viven acá.
 */
export function MonitorStep({ wizard }: { wizard: CollationConversionWizard }) {
  const { job, items, mode, savedTotals } = wizard
  const [cancelModalOpen, setCancelModalOpen] = useState(false)

  if (job.isLoading && !job.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Cargando estado del job…
      </div>
    )
  }
  if (job.isError && !job.data) {
    return <ErrorState error={job.error} title="No se pudo cargar el estado de la conversión" />
  }

  const data = job.data
  if (!data) return null

  const status = data.status
  const isTerminal = ['succeeded', 'failed', 'interrupted', 'canceled'].includes(status)
  const canCancel = status === 'pending' || status === 'running'

  const loadedItems = items.data?.items ?? []
  const dropWithoutCreateItem = loadedItems.find((item) => isDropWithoutCreateFailure(item.error))

  const tablesDone = data.progress?.tables_done ?? 0
  const objectsDone = data.progress?.objects_done ?? 0
  const showObjectsCounter = mode === 'universal' && (savedTotals?.objectsToRecreate ?? 0) > 0

  const singlePage = items.data && items.data.pagination.pages === 1
  const problemCount = singlePage
    ? loadedItems.filter((item) => item.status === 'error' || isFailedGrantsSkip(item)).length
    : null

  return (
    <div className="flex flex-col gap-5">
      {dropWithoutCreateItem && (
        <div className="flex flex-col gap-2 rounded-lg border border-error/40 bg-error/10 p-4">
          <p className="text-sm font-semibold text-error">
            🔴 {objectTypeLabel(dropWithoutCreateItem.object_type)} «
            {dropWithoutCreateItem.object_name}» ya no existe en el motor
          </p>
          {dropWithoutCreateItem.error && (
            <p className="whitespace-pre-wrap text-sm text-error">{dropWithoutCreateItem.error}</p>
          )}
          <p className="text-xs text-error/90">
            El objeto ya no existe en el motor. El DDL original quedó guardado en el servidor pero
            esta versión de la pantalla todavía no puede mostrártelo — pedile a soporte que lo
            revise en la base de metadatos del gateway.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            Convirtiendo collation de {wizard.database}
          </h2>
          {canCancel && (
            <Button variant="outline" onClick={() => setCancelModalOpen(true)}>
              Cancelar conversión
            </Button>
          )}
        </div>
        <PhaseBar mode={mode} phase={data.phase} />
      </div>

      {wizard.cancel.isSuccess && !isTerminal && (
        <p className="text-sm text-muted-foreground">
          Cancelación solicitada, esperando a que termine el paso en curso…
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <div className="flex flex-wrap gap-6">
          <div className="flex flex-col">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tablas
            </span>
            <span className="text-lg font-semibold text-foreground">
              {savedTotals
                ? `${tablesDone} de ${savedTotals.tablesToConvert}`
                : `${tablesDone} procesadas`}
            </span>
          </div>
          {showObjectsCounter && (
            <div className="flex flex-col">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Objetos
              </span>
              <span className="text-lg font-semibold text-foreground">
                {savedTotals
                  ? `${objectsDone} de ${savedTotals.objectsToRecreate}`
                  : `${objectsDone} procesados`}
              </span>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          El progreso se actualiza cada pocos segundos. Un paso lento (una tabla grande) puede
          tardar minutos sin que el contador se mueva — no es que el job esté colgado.
        </p>
      </div>

      {status === 'succeeded' && (
        <div className="flex flex-col gap-2 rounded-lg border border-success/30 bg-success/5 p-4">
          <p className="text-sm font-semibold text-foreground">✅ Conversión completada.</p>
          <Button variant="outline" className="self-start" onClick={() => wizard.goToStep('plan')}>
            Empezar un plan nuevo
          </Button>
        </div>
      )}

      {status === 'failed' && isSingleDatabaseAlterFailure(loadedItems) && (
        <div className="flex flex-col gap-2 rounded-lg border border-error/30 bg-error/5 p-4">
          <p className="text-sm font-semibold text-foreground">❌ La conversión no se ejecutó.</p>
          <p className="text-sm text-muted-foreground">
            No se pudo cambiar el charset por defecto de la base, y continuar habría dejado los
            objetos recreados apuntando al default viejo. La base NO fue modificada.
          </p>
          <Button variant="outline" className="self-start" onClick={() => wizard.goToStep('plan')}>
            Empezar un plan nuevo
          </Button>
        </div>
      )}

      {status === 'failed' && !isSingleDatabaseAlterFailure(loadedItems) && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <p className="text-sm font-semibold text-foreground">
            ⚠ Conversión completada con errores.
          </p>
          {problemCount != null ? (
            <p className="text-sm text-muted-foreground">
              {problemCount} de {loadedItems.length} pasos con problema.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Revisá el detalle de los pasos abajo: al menos uno falló.
            </p>
          )}
          <Button variant="outline" className="self-start" onClick={() => wizard.goToStep('plan')}>
            Empezar un plan nuevo
          </Button>
        </div>
      )}

      {status === 'canceled' && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <p className="text-sm font-semibold text-foreground">⏹ Conversión cancelada.</p>
          <p className="text-sm text-muted-foreground">
            Lo ya aplicado NO se revirtió: la base quedó parcialmente convertida.
          </p>
          <Button variant="outline" className="self-start" onClick={() => wizard.goToStep('plan')}>
            Empezar un plan nuevo
          </Button>
        </div>
      )}

      {status === 'interrupted' && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <p className="text-sm font-semibold text-foreground">
            ⚠ El gateway se reinició durante la conversión.
          </p>
          <p className="text-sm text-muted-foreground">
            Revisá los pasos ya aplicados antes de crear un plan nuevo.
          </p>
          <Button variant="outline" className="self-start" onClick={() => wizard.goToStep('plan')}>
            Empezar un plan nuevo
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pasos ejecutados
        </p>
        {items.isLoading && !items.data ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> Cargando pasos…
          </div>
        ) : items.isError && !items.data ? (
          <ErrorState error={items.error} title="No se pudieron cargar los pasos" />
        ) : loadedItems.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Seq</th>
                    <th className="px-3 py-2 font-semibold">Tipo</th>
                    <th className="px-3 py-2 font-semibold">Nombre</th>
                    <th className="px-3 py-2 font-semibold">Estado</th>
                    <th className="px-3 py-2 font-semibold">Duración</th>
                    <th className="px-3 py-2 font-semibold">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {loadedItems.map((item) => (
                    <tr key={item.id} className="border-b border-border align-top last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">{item.seq}</td>
                      <td className="px-3 py-2 text-foreground">
                        {objectTypeLabel(item.object_type)}
                      </td>
                      <td className="px-3 py-2 text-foreground">{item.object_name}</td>
                      <td className="px-3 py-2">
                        <ItemStatusCell item={item} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDuration(item.execution_ms)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <div className="flex flex-col gap-1">
                          {mode === 'columns' && item.columns_affected != null && (
                            <span>{item.columns_affected} columnas</span>
                          )}
                          {item.grants_captured != null && (
                            <span title="grants_captured > grants_reapplied sin grants_error es normal: la reaplicación omite grants vacíos o sin GRANT OPTION.">
                              {item.grants_reapplied ?? 0} de {item.grants_captured} privilegios
                              reaplicados
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={wizard.itemsPage}
              pages={items.data?.pagination.pages ?? 1}
              total={items.data?.pagination.total ?? 0}
              size={items.data?.pagination.size ?? 20}
              hasNext={items.data?.pagination.has_next ?? false}
              hasPrev={items.data?.pagination.has_prev ?? false}
              onPageChange={wizard.setItemsPage}
              isFetching={items.isFetching}
            />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Aún no hay pasos registrados.</p>
        )}
      </div>

      <Modal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title="Cancelar la conversión"
        footer={
          <>
            <Button variant="outline" onClick={() => setCancelModalOpen(false)}>
              Seguir convirtiendo
            </Button>
            <Button
              variant="danger"
              isLoading={wizard.cancel.isPending}
              onClick={() => {
                wizard.cancel.mutate()
                setCancelModalOpen(false)
              }}
            >
              Solicitar cancelación
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            La cancelación es cooperativa: el paso EN CURSO va a terminar (una tabla grande puede
            tardar varios minutos más). Solo se detienen los pasos que todavía no empezaron.
          </p>
          <p className="font-medium text-warning">
            ⚠ Lo ya convertido NO se revierte. La base va a quedar PARCIALMENTE convertida, con los
            riesgos de una conversión parcial.
          </p>
        </div>
      </Modal>
    </div>
  )
}
