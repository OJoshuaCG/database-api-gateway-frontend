import { Button, ErrorState } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { CONVERSION_ACTION_LABELS, classifyConversionError, type ConversionErrorAction } from './messages'

interface ErrorRecoveryPanelProps {
  error: unknown
  title: string
  onReplan?: () => void
  onForceStaleInventory?: () => void
  onForceQuarantine?: () => void
  onForceStaleAtExecute?: () => void
  onRecomputeToken?: () => void
  onReviewSelection?: () => void
  onPreviewFirst?: () => void
  isRecovering?: boolean
}

/**
 * `ErrorState` + el CTA de recuperación correcto para un error del asistente de conversión de
 * collation, centralizando en un solo lugar el mapeo acción→handler (mismo criterio que
 * `database-clones/wizard/ErrorRecoveryPanel.tsx`). Si no se provee un handler para la acción
 * clasificada, NO se renderiza botón: nunca un botón que no hace nada al hacer clic.
 */
export function ErrorRecoveryPanel({
  error,
  title,
  onReplan,
  onForceStaleInventory,
  onForceQuarantine,
  onForceStaleAtExecute,
  onRecomputeToken,
  onReviewSelection,
  onPreviewFirst,
  isRecovering = false,
}: ErrorRecoveryPanelProps) {
  const action = classifyConversionError(toApiError(error))
  const handlers: Partial<Record<ConversionErrorAction, () => void>> = {
    replan: onReplan,
    forceStaleInventory: onForceStaleInventory,
    forceQuarantine: onForceQuarantine,
    forceStaleAtExecute: onForceStaleAtExecute,
    recomputeToken: onRecomputeToken,
    reviewSelection: onReviewSelection,
    previewFirst: onPreviewFirst,
  }
  const handler = handlers[action]
  const label = CONVERSION_ACTION_LABELS[action]

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
