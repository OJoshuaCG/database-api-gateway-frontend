import { Badge, Button, ErrorState } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import {
  EXPORT_ACTION_HINTS,
  EXPORT_ACTION_LABELS,
  classifyExportError,
  exportErrorHint,
  type ExportErrorAction,
} from '../messages'

interface ErrorRecoveryPanelProps {
  error: unknown
  title: string
  onStartOver?: () => void
  onRepreview?: () => void
  onResolveDependencies?: () => void
  onAddToStructure?: () => void
  onSwitchToFileDelivery?: () => void
  onGoToOriginalPlan?: (jobId: number) => void
  isRecovering?: boolean
}

/**
 * `ErrorState` + el CTA de recuperación correcto para un fallo del flujo de exportación.
 *
 * A diferencia del panel de database-clones —que reconoce fragmentos del mensaje con expresiones
 * regulares porque ese backend no expone nada estructurado— acá la clasificación sale de
 * `detail.public_context.code`, que es estable y viaja también en producción. El texto del mensaje
 * no decide nunca: el mismo 409 puede ser una cuota agotada (esperar), un plan ya usado (empezar de
 * nuevo) o una huella cambiada (volver a previsualizar), y confundirlos manda al usuario a hacer
 * justo lo contrario de lo que toca.
 *
 * Si no hay handler para la acción clasificada, NO se renderiza botón: nunca un botón que no hace
 * nada al hacer clic.
 */
export function ErrorRecoveryPanel({
  error,
  title,
  onStartOver,
  onRepreview,
  onResolveDependencies,
  onAddToStructure,
  onSwitchToFileDelivery,
  onGoToOriginalPlan,
  isRecovering = false,
}: ErrorRecoveryPanelProps) {
  const apiError = toApiError(error)
  const action = classifyExportError(apiError)
  const context = apiError.exportContext
  const originalPlanId = context?.exportJobId ?? null

  const handlers: Partial<Record<ExportErrorAction, (() => void) | undefined>> = {
    startOver: onStartOver,
    repreview: onRepreview,
    resolveDependencies: onResolveDependencies,
    addToStructure: onAddToStructure,
    switchToFileDelivery: onSwitchToFileDelivery,
    // Sin el id del plan original el botón no tendría a dónde ir, así que no se ofrece.
    goToOriginalPlan:
      onGoToOriginalPlan && originalPlanId != null
        ? () => onGoToOriginalPlan(originalPlanId)
        : undefined,
  }
  const handler = handlers[action]
  const label = EXPORT_ACTION_LABELS[action]

  const codeHint = exportErrorHint(apiError)
  const actionHint = EXPORT_ACTION_HINTS[action]

  const missingDependencies = context?.missingDependencies ?? []
  const suggestedNames = context?.suggestedNames ?? []

  return (
    <div className="flex flex-col gap-2">
      <ErrorState error={error} title={title} />

      {codeHint && <p className="text-sm text-muted-foreground">{codeHint}</p>}

      {/**
       * Un 422 `export.incompatible_option` / `export.invalid_row_filter` señala un control
       * concreto: decir cuál —y qué valores admite— es la diferencia entre un error accionable y
       * uno que obliga a revisar el formulario entero a ciegas.
       */}
      {action === 'fixField' && context?.field && (
        <p className="text-sm text-foreground">
          Campo a corregir: <code className="font-mono text-xs">{context.field}</code>
          {context.allowed && context.allowed.length > 0 && (
            <>
              {' · admite '}
              {context.allowed.map((value) => (
                <Badge key={value} tone="neutral" className="ml-1">
                  {value}
                </Badge>
              ))}
            </>
          )}
        </p>
      )}

      {/**
       * Las dependencias que faltan se listan ANTES de ofrecer el botón: el backend falla en vez de
       * podar precisamente porque una selección explícita no se recorta en silencio, así que el
       * usuario tiene que ver qué se le va a agregar antes de aceptarlo.
       */}
      {missingDependencies.length > 0 && (
        <div className="flex flex-col gap-1 text-sm text-foreground">
          <p>Faltan estos objetos:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
            {missingDependencies.map((object) => (
              <li key={`${object.objectType}:${object.name}`}>
                <span className="font-mono text-xs">{object.name}</span> ({object.objectType})
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestedNames.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Sugeridos para cerrar la selección: {suggestedNames.join(', ')}
        </p>
      )}

      {actionHint && <p className="text-sm text-muted-foreground">{actionHint}</p>}

      {handler && label && (
        <Button variant="outline" className="self-start" onClick={handler} isLoading={isRecovering}>
          {label}
        </Button>
      )}
    </div>
  )
}
