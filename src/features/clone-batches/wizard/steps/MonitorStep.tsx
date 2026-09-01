import { Link } from 'react-router-dom'
import { Badge, Button, Callout, ErrorState, Pagination, Spinner } from '@/components/ui'
import {
  batchStatusLabel,
  batchStatusTone,
  completedCount,
  itemStatusLabel,
  itemStatusTone,
} from '../logic'
import { DurationByDatabase } from '../DurationByDatabase'
import type { CloneBatchWizard } from '../use-clone-batch-wizard'

/**
 * Paso 4 — seguimiento del recorrido.
 *
 * Dos cosas que esta vista tiene que dejar claras y que no se deducen de un porcentaje: que las
 * bases se copian **de a una** (así que "4 de 12" no es lentitud, es el diseño), y que al
 * terminar hay DOS grupos distintos de filas no exitosas — las que se pueden relanzar solas y
 * las que dejaron el destino tocado y hay que resolver a mano.
 */
export function MonitorStep({ wizard }: { wizard: CloneBatchWizard }) {
  const { batch, items, retryCandidates } = wizard

  if (batch.isLoading && !batch.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Cargando el lote…
      </div>
    )
  }
  if (batch.isError && !batch.data) {
    return <ErrorState error={batch.error} title="No se pudo leer el estado del lote" />
  }
  if (!batch.data) return null

  const data = batch.data
  const hechas = completedCount(data.counts)
  const enCurso = data.status === 'pending' || data.status === 'running'
  const filas = items.data?.items ?? []

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Lote #{data.id}</h2>
            <Badge tone={batchStatusTone(data.status)}>{batchStatusLabel(data.status)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {hechas} de {data.total} bases · se copian de a una por vez
          </p>
        </div>
        {enCurso && (
          <Button
            variant="danger-soft"
            onClick={() => wizard.cancel.mutate()}
            isLoading={wizard.cancel.isPending}
            disabled={data.cancel_requested}
          >
            {data.cancel_requested ? 'Cancelación pedida' : 'Cancelar lote'}
          </Button>
        )}
      </div>

      {data.error && (
        <Callout tone="warning" title="El lote no terminó de forma normal">
          {data.error}
        </Callout>
      )}

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(data.counts)
          .filter(([key]) => key !== 'total')
          .map(([status, cantidad]) => (
            <Badge key={status} tone={itemStatusTone(status as never)}>
              {itemStatusLabel(status as never)}: {cantidad}
            </Badge>
          ))}
      </div>

      <div className="flex flex-col gap-2">
        {filas.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="break-all text-sm text-foreground">
                <span className="text-muted-foreground">{row.seq}.</span>{' '}
                {row.source_database_name} <span className="text-muted-foreground">→</span>{' '}
                {row.target_database_name}
              </span>
              {row.error && <span className="text-xs text-error">{row.error}</span>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={itemStatusTone(row.status)}>{itemStatusLabel(row.status)}</Badge>
              {/* La fila materializada mantiene su pantalla de detalle de siempre: el lote no
                  reemplaza al asistente individual, lo orquesta. */}
              {row.clone_job_id != null && (
                <Link
                  className="text-xs text-primary underline-offset-2 hover:underline"
                  to={`/database-clones/${row.clone_job_id}`}
                >
                  ver detalle
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>

      {items.data && items.data.pagination.pages > 1 && (
        <Pagination
          page={items.data.pagination.page}
          pages={items.data.pagination.pages}
          total={items.data.pagination.total}
          size={items.data.pagination.size}
          hasNext={items.data.pagination.has_next}
          hasPrev={items.data.pagination.has_prev}
          onPageChange={wizard.setItemsPage}
          isFetching={items.isFetching}
        />
      )}

      {filas.length > 0 && <DurationByDatabase batch={data} items={filas} />}

      {retryCandidates.data && <RetryPanel wizard={wizard} />}

      {!enCurso && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={wizard.reset}>
            Nuevo lote
          </Button>
        </div>
      )}
    </div>
  )
}

function RetryPanel({ wizard }: { wizard: CloneBatchWizard }) {
  const data = wizard.retryCandidates.data
  if (!data) return null
  if (data.retryable.length === 0 && data.needs_manual.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {data.retryable.length > 0 && (
        <Callout
          tone="info"
          title={`${data.retryable.length} bases se pueden reintentar`}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={wizard.submitRetry}
              isLoading={wizard.retry.isPending}
            >
              Reintentar las que faltaron
            </Button>
          }
        >
          Su destino quedó intacto, así que se pueden relanzar sin riesgo:{' '}
          {data.retryable.map((row) => row.target_database_name).join(', ')}. Se arma un lote
          nuevo que hay que confirmar.
        </Callout>
      )}

      {data.needs_manual.length > 0 && (
        <Callout
          tone="danger"
          title={`${data.needs_manual.length} bases requieren atención`}
        >
          <div className="flex flex-col gap-1">
            {data.needs_manual.map((row) => (
              <p key={row.id} className="text-xs">
                <strong>{row.target_database_name}</strong>: {row.reason}
              </p>
            ))}
          </div>
        </Callout>
      )}
    </div>
  )
}
