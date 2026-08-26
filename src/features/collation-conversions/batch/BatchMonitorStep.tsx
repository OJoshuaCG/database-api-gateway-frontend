import { Badge, Button, ErrorState, Spinner, type BadgeTone } from '@/components/ui'
import type {
  CollationBatchStatus,
  CollationBatchStatusOut,
  CollationJobStatus,
} from '@/lib/contracts'

/**
 * Paso 3 del lote: seguirlo mientras corre.
 *
 * **El lote corre EN SERIE.** `COLLATION_CONVERSION_MAX_WORKERS` es 1 por default, así que las
 * bases se convierten una después de otra y un lote de 12 monopoliza el módulo por horas. Sin
 * decirlo, esta pantalla parece colgada: se ve una base "en curso" y once "en cola" sin que nada
 * se mueva durante mucho tiempo, que es exactamente el aspecto de un job muerto.
 *
 * `counts` viene del servidor y no se calcula acá: existe justamente para no recorrer N filas en
 * cada tick del polling.
 */

const BATCH_STATUS_META: Record<CollationBatchStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Sin ejecutar', tone: 'neutral' },
  running: { label: 'En curso', tone: 'primary' },
  done: { label: 'Terminado', tone: 'success' },
  failed: { label: 'Con errores', tone: 'error' },
  canceled: { label: 'Cancelado', tone: 'warning' },
}

const JOB_STATUS_META: Record<CollationJobStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'En cola', tone: 'neutral' },
  running: { label: 'Convirtiendo', tone: 'primary' },
  succeeded: { label: 'Lista', tone: 'success' },
  failed: { label: 'Error', tone: 'error' },
  interrupted: { label: 'Interrumpida', tone: 'error' },
  canceled: { label: 'Cancelada', tone: 'warning' },
}

export function BatchMonitorStep({
  data,
  isLoading,
  error,
  isCanceling,
  onCancel,
  versionSlot,
}: {
  data: CollationBatchStatusOut | undefined
  isLoading: boolean
  error: unknown
  isCanceling: boolean
  onCancel: () => void
  /** La tarjeta de versión de contabilidad; solo se pinta cuando el lote terminó bien. */
  versionSlot: React.ReactNode
}) {
  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Cargando estado del lote…
      </div>
    )
  }
  if (error && !data) {
    return <ErrorState error={error} title="No se pudo cargar el estado del lote" />
  }
  if (!data) return null

  const { batch, jobs } = data
  const meta = BATCH_STATUS_META[batch.status]
  const canCancel = batch.status === 'pending' || batch.status === 'running'

  // Ordenado por `batch_seq` y no por el orden de llegada: es lo único que da un orden estable
  // ("la 4 de 12"). El estado no alcanza — no distingue "en cola" de "terminada" de forma
  // reproducible entre ticks.
  const ordered = [...jobs].sort((a, b) => (a.batch_seq ?? 0) - (b.batch_seq ?? 0))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="text-sm text-muted-foreground">
            {batch.counts.done + batch.counts.failed + batch.counts.canceled} de{' '}
            {batch.counts.total} bases procesadas
          </span>
          {batch.capped && (
            <span className="text-sm text-warning">
              El tope dejó bases del blueprint afuera de este lote.
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">En cola: {batch.counts.queued}</span>
          <span className="text-muted-foreground">Convirtiendo: {batch.counts.running}</span>
          <span className="text-success">Listas: {batch.counts.done}</span>
          {batch.counts.failed > 0 && <span className="text-error">Con error: {batch.counts.failed}</span>}
          {batch.counts.canceled > 0 && (
            <span className="text-warning">Canceladas: {batch.counts.canceled}</span>
          )}
        </div>

        {batch.runs_serially && batch.status === 'running' && (
          <p className="text-xs text-muted-foreground">
            Las bases se convierten <strong>una después de otra</strong>. Una tabla grande puede
            tardar minutos sin que nada se mueva — no es que esté colgado.
          </p>
        )}

        {batch.error && <p className="text-sm text-error">{batch.error}</p>}

        {canCancel && (
          <div>
            <Button variant="outline" onClick={onCancel} disabled={isCanceling}>
              {isCanceling && <Spinner />}
              Cancelar lo que no arrancó
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              Las bases en cola no llegan a tocar el motor. La que está convirtiendo termina su
              paso y corta en el próximo punto seguro: matar un <code>ALTER TABLE</code> a mitad
              dejaría la tabla a medio reescribir.
            </p>
          </div>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {ordered.map((job) => {
          const jobMeta = JOB_STATUS_META[job.status]
          const tablesDone = job.progress?.tables_done ?? 0
          return (
            <li
              key={job.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-3 text-sm"
            >
              <span className="font-mono text-xs text-muted-foreground">
                {job.batch_seq !== null ? `${job.batch_seq} de ${batch.total}` : '—'}
              </span>
              <span className="font-medium text-foreground">{job.database_name}</span>
              <Badge tone={jobMeta.tone}>{jobMeta.label}</Badge>
              <span className="text-muted-foreground">
                {/* Totales del servidor: sobreviven la recarga, que en un lote de horas importa. */}
                {job.tables_total !== null
                  ? `${tablesDone} de ${job.tables_total} tablas`
                  : `${tablesDone} tablas`}
              </span>
              {job.error && <span className="w-full text-error">{job.error}</span>}
            </li>
          )
        })}
      </ul>

      {batch.status === 'done' && versionSlot}
    </div>
  )
}
