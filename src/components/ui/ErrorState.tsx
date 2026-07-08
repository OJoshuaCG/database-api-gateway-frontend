import { toApiError } from '@/lib/api/errors'
import { Button } from './Button'

interface ErrorStateProps {
  error: unknown
  onRetry?: () => void
  title?: string
}

/** Estado de error reutilizable. Muestra el mensaje normalizado de la API y permite reintentar. */
export function ErrorState({
  error,
  onRetry,
  title = 'No se pudieron cargar los datos',
}: ErrorStateProps) {
  const apiError = toApiError(error)
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-card border border-error/30 bg-error/5 px-6 py-10 text-center"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{apiError.message}</p>
        {apiError.isEngineError && (
          <p className="max-w-md text-xs text-muted-foreground">
            El servidor de base de datos destino no respondió. Verifica su disponibilidad y la
            conectividad de red.
          </p>
        )}
        {apiError.requestId && (
          <p className="max-w-md text-xs text-muted-foreground">
            ID de solicitud: <code className="font-mono">{apiError.requestId}</code>
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  )
}
