import { Badge, Button, ErrorState, Spinner } from '@/components/ui'
import { formatCountdown } from '@/lib/utils/countdown'
import { useCountdown } from '@/lib/utils/use-countdown'
import type { CollationJobPhase, CollationJobStatus } from '@/lib/contracts'
import type { CollationConversionWizard } from '../use-collation-conversion-wizard'

const STATUS_TONE: Record<CollationJobStatus, 'neutral' | 'primary' | 'success' | 'error' | 'warning'> = {
  pending: 'neutral',
  running: 'primary',
  succeeded: 'success',
  failed: 'error',
  interrupted: 'warning',
  canceled: 'warning',
}

/** Todo el texto de la UI va en español: nunca se muestra el valor crudo del enum del contrato. */
const STATUS_LABELS: Record<CollationJobStatus, string> = {
  pending: 'pendiente',
  running: 'en curso',
  succeeded: 'completada',
  failed: 'con errores',
  interrupted: 'interrumpida',
  canceled: 'cancelada',
}

const PHASE_LABELS: Record<CollationJobPhase, string> = {
  database: 'base de datos',
  tables: 'tablas',
  objects: 'objetos',
  done: 'listo',
}

/**
 * Vista 1 — punto de reentrada por `?jobId=`: muestra el estado actual del plan de conversión y
 * ofrece continuar por la rama correcta según `status`/`expired` (nunca reejecuta nada por sí sola,
 * mismo criterio que `database-clones/wizard/steps/SummaryStep.tsx`).
 */
export function SummaryStep({ wizard }: { wizard: CollationConversionWizard }) {
  const { job } = wizard
  // `useCountdown` es la única fuente de "ahora": leer `Date.now()` acá sería impuro en render.
  const remaining = useCountdown(job.data?.expires_at ?? null)

  if (job.isLoading && !job.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Cargando plan de conversión…
      </div>
    )
  }
  if (job.isError && !job.data) {
    return <ErrorState error={job.error} title="No se pudo cargar el plan de conversión" />
  }
  const data = job.data
  if (!data) return null

  const expiredPending = data.expired && data.status === 'pending'
  const isActive = data.status === 'pending' || data.status === 'running'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">
          Conversión #{data.id}: {data.database_name} ({data.engine})
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[data.status] ?? 'neutral'}>{STATUS_LABELS[data.status] ?? data.status}</Badge>
          {data.phase && <Badge tone="neutral">{PHASE_LABELS[data.phase] ?? data.phase}</Badge>}
          {data.expired && <Badge tone="error">expirado — replanea</Badge>}
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm text-foreground">
        <p>
          Charset/collation: {data.previous_db_charset ?? '—'}/{data.previous_db_collation ?? '—'} →{' '}
          {data.target_charset ?? '—'}/{data.target_collation}
        </p>
        {!data.expired && remaining > 0 && (
          <p className="text-xs text-muted-foreground">
            El plan vence en <span className="font-mono text-foreground">{formatCountdown(remaining)}</span>
          </p>
        )}
        {data.error && <p className="text-xs text-error">{data.error}</p>}
      </div>

      {expiredPending ? (
        <div className="flex flex-col gap-2">
          <p className="rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-foreground">
            Este plan expiró antes de llegar a ejecutarse. Crea uno nuevo para continuar.
          </p>
          <Button className="self-start" onClick={() => wizard.goToStep('plan')}>
            Crear un plan nuevo
          </Button>
        </div>
      ) : isActive ? (
        <Button className="self-start" onClick={() => wizard.goToStep('monitor')}>
          Ver progreso →
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => wizard.goToStep('monitor')}>Ver resultado →</Button>
          <Button variant="ghost" onClick={() => wizard.goToStep('plan')}>
            Empezar un plan nuevo
          </Button>
        </div>
      )}
    </div>
  )
}
