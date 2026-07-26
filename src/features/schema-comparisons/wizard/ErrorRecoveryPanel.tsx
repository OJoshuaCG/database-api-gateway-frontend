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
  /** CTA "Resolver automáticamente" del 422 de dependencias (§10.6): el caller incorpora los
   * `suggested_item_ids` del error a la selección y vuelve a confirmar. */
  onResolveDependencies?: () => void
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
  onResolveDependencies,
  isRecovering = false,
}: ErrorRecoveryPanelProps) {
  const apiError = toApiError(error)
  const action = classifyComparisonError(apiError)
  const handlers: Partial<Record<ComparisonErrorAction, () => void>> = {
    recalculate: onRecalculate,
    switchToAdopt: onSwitchToAdopt,
    switchToExecute: onSwitchToExecute,
    forceQuarantine: onForceQuarantine,
    recomputeToken: onRecomputeToken,
    resolveDependencies: onResolveDependencies,
  }
  const handler = handlers[action]
  const label = ACTION_LABELS[action]

  return (
    <div className="flex flex-col gap-2">
      <ErrorState error={error} title={title} />
      {action === 'resolveDependencies' &&
        apiError.missingDependencies &&
        apiError.missingDependencies.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-3">
            <p className="text-xs font-medium text-foreground">
              Dependencias faltantes en la selección:
            </p>
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              {apiError.missingDependencies.map((opGroup) => (
                <li key={opGroup}>
                  <code className="font-mono">{opGroup}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
      {handler && label && (
        <Button variant="outline" className="self-start" onClick={handler} isLoading={isRecovering}>
          {label}
        </Button>
      )}
    </div>
  )
}
