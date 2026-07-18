import { Badge, Button, ErrorState, Spinner } from '@/components/ui'
import type { DatabaseCloneWizard } from '../use-database-clone-wizard'

const STATUS_TONE: Record<string, 'neutral' | 'primary' | 'success' | 'error' | 'warning'> = {
  pending: 'neutral',
  running: 'primary',
  succeeded: 'success',
  failed: 'error',
  interrupted: 'warning',
  canceled: 'warning',
}

/**
 * Vista 2 — punto de reentrada por `?jobId=`: muestra el estado actual del plan y ofrece
 * continuar por la rama correcta según `status` (nunca reejecuta nada por sí sola).
 */
export function SummaryStep({ wizard }: { wizard: DatabaseCloneWizard }) {
  if (wizard.job.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Cargando plan de clonación…
      </div>
    )
  }
  if (wizard.job.isError) {
    return <ErrorState error={wizard.job.error} title="No se pudo cargar el plan de clonación" />
  }
  const job = wizard.job.data
  if (!job) return null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">
          Clon #{job.id}: {job.source_database_name} ({job.source_engine}) → {job.target_database_name} (
          {job.target_engine})
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[job.status] ?? 'neutral'}>{job.status}</Badge>
          {job.phase && <Badge tone="neutral">{job.phase}</Badge>}
          <Badge tone="neutral">{job.include_data ? 'con datos' : 'solo estructura'}</Badge>
          <Badge tone="neutral">{job.target_mode === 'new' ? 'destino nuevo' : 'destino existente'}</Badge>
          {job.cross_engine && <Badge tone="warning">⚠ cross-engine</Badge>}
          {job.expired && <Badge tone="error">expirado — replanea</Badge>}
        </div>
      </div>

      {job.expired ? (
        <p className="rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-foreground">
          Este plan expiró. Crea uno nuevo para continuar.
        </p>
      ) : job.status === 'pending' ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => wizard.goToStep('selection')}>
            Selección parcial de objetos →
          </Button>
          <Button onClick={() => wizard.goToStep('preview')}>Previsualizar clon completo →</Button>
        </div>
      ) : job.status === 'running' ? (
        <Button onClick={() => wizard.goToStep('monitor')}>Ver monitor →</Button>
      ) : (
        <Button onClick={() => wizard.goToStep('monitor')}>Ver resultado →</Button>
      )}

      <Button variant="ghost" className="self-start" onClick={wizard.replan}>
        Empezar un plan nuevo
      </Button>
    </div>
  )
}
