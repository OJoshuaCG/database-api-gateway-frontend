import { cn } from '@/lib/utils'
import { isHealthConfigured } from '../api/health.api'
import { useReadiness } from '../hooks/use-readiness'

/**
 * Indicador del estado del backend (readiness). Se degrada en silencio si `/health`
 * no está configurado o el navegador bloquea la petición por CORS.
 */
export function HealthBadge() {
  const { data, isError, isLoading } = useReadiness()

  if (!isHealthConfigured()) return null

  const healthy = data?.ok === true && data.data.status === 'ready'
  const label = isLoading
    ? 'Comprobando…'
    : isError
      ? 'API sin respuesta'
      : healthy
        ? 'API operativa'
        : 'API no disponible'

  const tone = isLoading ? 'bg-muted-foreground' : healthy ? 'bg-success' : 'bg-error'

  return (
    <span
      className="hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground sm:inline-flex"
      title={label}
    >
      <span className={cn('h-2 w-2 rounded-full', tone)} aria-hidden />
      {label}
    </span>
  )
}
