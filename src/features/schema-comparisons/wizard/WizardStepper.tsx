import { cn } from '@/lib/utils'
import { WIZARD_STAGES, type SchemaComparisonWizard, type WizardStep } from './use-schema-comparison-wizard'

/**
 * Indicador de pasos del asistente. Las etapas ya completadas son navegables hacia atrás; la
 * actual se resalta; las futuras quedan inertes. `items` y las 4 vistas de acción se agrupan
 * bajo las etapas "Resumen"/"Acción" respectivamente (mismo técnica que el asistente de snapshot
 * agrupa su paso `manual` bajo "Versionado").
 */
export function WizardStepper({ wizard }: { wizard: SchemaComparisonWizard }) {
  const activeIndex = wizard.step === 'result' ? WIZARD_STAGES.length : wizard.stageIndex

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" aria-label="Pasos">
      {WIZARD_STAGES.map((stage, index) => {
        const isCurrent = index === activeIndex
        const isDone = index < activeIndex
        const canJump = isDone && wizard.step !== 'result'
        const jumpTarget: WizardStep =
          stage.key === 'selector' ? 'selector' : stage.key === 'summary' ? 'summary' : (wizard.actionEntryStep ?? 'summary')
        return (
          <li key={stage.key} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canJump}
              onClick={() => canJump && wizard.goToStep(jumpTarget)}
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1 font-medium transition-colors',
                isCurrent && 'bg-primary text-primary-foreground',
                isDone && 'text-success hover:bg-surface-muted',
                !isCurrent && !isDone && 'text-muted-foreground',
                !canJump && 'cursor-default',
              )}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full border text-xs',
                  isCurrent && 'border-primary-foreground',
                  isDone && 'border-success',
                  !isCurrent && !isDone && 'border-border',
                )}
              >
                {isDone ? '✓' : index + 1}
              </span>
              {stage.label}
            </button>
            {index < WIZARD_STAGES.length - 1 && (
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
