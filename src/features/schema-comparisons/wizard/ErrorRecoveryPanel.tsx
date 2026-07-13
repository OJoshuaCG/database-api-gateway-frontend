import { Button, ErrorState } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { ACTION_LABELS, classifyComparisonError, type ComparisonErrorAction } from './messages'

interface ErrorRecoveryPanelProps {
  error: unknown
  title: string
  onRecalculate?: () => void
  onSwitchToAdopt?: () => void
  onSwitchToExecute?: () => void
  onForceQuarantine?: () => void
  onRecomputeToken?: () => void
  /** Refleja el estado de carga de la acción de recuperación disparada (p. ej. recalcular). */
  isRecovering?: boolean
}

/**
 * `ErrorState` + el CTA de recuperación correcto para un error del flujo de comparación,
 * centralizando en un solo lugar el mapeo acción→handler (antes reimplementado de forma
 * divergente en cada paso). Si no se provee un handler para la acción clasificada, NO se
 * renderiza botón: nunca un botón que no hace nada al hacer clic.
 */
export function ErrorRecoveryPanel({
  error,
  title,
  onRecalculate,
  onSwitchToAdopt,
  onSwitchToExecute,
  onForceQuarantine,
  onRecomputeToken,
  isRecovering = false,
}: ErrorRecoveryPanelProps) {
  const action = classifyComparisonError(toApiError(error))
  const handlers: Partial<Record<ComparisonErrorAction, () => void>> = {
    recalculate: onRecalculate,
    switchToAdopt: onSwitchToAdopt,
    switchToExecute: onSwitchToExecute,
    forceQuarantine: onForceQuarantine,
    recomputeToken: onRecomputeToken,
  }
  const handler = handlers[action]
  const label = ACTION_LABELS[action]

  return (
    <div className="flex flex-col gap-2">
      <ErrorState error={error} title={title} />
      {handler && label && (
        <Button variant="outline" className="self-start" onClick={handler} isLoading={isRecovering}>
          {label}
        </Button>
      )}
    </div>
  )
}
