import { Button, ErrorState } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { CLONE_ACTION_LABELS, classifyCloneError, type CloneErrorAction } from './messages'

interface ErrorRecoveryPanelProps {
  error: unknown
  title: string
  onReplan?: () => void
  onForceQuarantine?: () => void
  onRecomputeToken?: () => void
  onSwitchToExistingTarget?: () => void
  onSwitchToNewTarget?: () => void
  isRecovering?: boolean
}

/**
 * `ErrorState` + el CTA de recuperación correcto para un error del flujo de clonado, centralizando
 * en un solo lugar el mapeo acción→handler. Si no se provee un handler para la acción clasificada,
 * NO se renderiza botón: nunca un botón que no hace nada al hacer clic.
 */
export function ErrorRecoveryPanel({
  error,
  title,
  onReplan,
  onForceQuarantine,
  onRecomputeToken,
  onSwitchToExistingTarget,
  onSwitchToNewTarget,
  isRecovering = false,
}: ErrorRecoveryPanelProps) {
  const action = classifyCloneError(toApiError(error))
  const handlers: Partial<Record<CloneErrorAction, () => void>> = {
    replan: onReplan,
    forceQuarantine: onForceQuarantine,
    recomputeToken: onRecomputeToken,
    switchToExistingTarget: onSwitchToExistingTarget,
    switchToNewTarget: onSwitchToNewTarget,
  }
  const handler = handlers[action]
  const label = CLONE_ACTION_LABELS[action]

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
