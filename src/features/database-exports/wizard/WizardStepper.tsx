import { cn } from '@/lib/utils'
import type { DatabaseExportWizard, ExportWizardStep } from './use-database-export-wizard'

const STEP_LABELS: Partial<Record<ExportWizardStep, string>> = {
  origin: 'Origen y formato',
  objects: 'Qué exportar',
  options: 'Opciones',
  confirm: 'Confirmar',
}

/**
 * Indicador de pasos del asistente. Las etapas se derivan de `wizard.order` —la única fuente de
 * verdad del orden— y no de una lista escrita acá: si el hook cambia el recorrido, el indicador lo
 * sigue sin tocar este archivo. Se filtra `monitor` porque no es una etapa del formulario sino el
 * desenlace del job.
 *
 * Solo los pasos ya completados son clicables, y **nunca desde el monitor**: llegar ahí significa
 * que el plan ya se consumió (un plan es de un solo uso), así que volver atrás ofrecería editar una
 * configuración que ya no se puede reenviar.
 */
export function WizardStepper({ wizard }: { wizard: DatabaseExportWizard }) {
  const stages: ExportWizardStep[] = wizard.order.filter((step) => step !== 'monitor')
  const activeIndex = stages.indexOf(wizard.step)

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" aria-label="Pasos">
      {stages.map((stageKey, index) => {
        const isCurrent = index === activeIndex
        const isDone = activeIndex >= 0 && index < activeIndex
        const canJump = isDone && wizard.step !== 'monitor'
        return (
          <li key={stageKey} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canJump}
              onClick={() => canJump && wizard.goToStep(stageKey)}
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1 font-medium transition-colors',
                isCurrent && 'bg-primary text-primary-foreground',
                isDone && 'text-success hover:bg-primary/10',
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
              {STEP_LABELS[stageKey]}
            </button>
            {index < stages.length - 1 && (
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
