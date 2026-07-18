import { cn } from '@/lib/utils'
import type { DatabaseCloneWizard, WizardStep } from './use-database-clone-wizard'

const STAGE_LABELS: Partial<Record<WizardStep, string>> = {
  plan: 'Plan',
  selection: 'Selección',
  preview: 'Vista previa',
  monitor: 'Monitor',
}

/**
 * Indicador de pasos del asistente. Deriva las etapas mostradas de `wizard.order` (filtrando
 * `summary`, una pantalla de tránsito, no una etapa del flujo) en vez de una lista fija: `order`
 * ya excluye `selection` para un clon COMPLETO (nunca se visita), así que el indicador nunca la
 * marca como "completada"/navegable para un plan que nunca pasó por ahí — evitar eso importa
 * porque saltar a esa vista permitiría sobrescribir `finalSelection` (que debía quedar `null`
 * para un clon completo) con una selección parcial no pedida. Los pasos ya visitados son
 * navegables hacia atrás; el monitor, una vez alcanzado, es terminal.
 */
export function WizardStepper({ wizard }: { wizard: DatabaseCloneWizard }) {
  const stages: WizardStep[] = wizard.order.filter((step) => step !== 'summary')
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
              {STAGE_LABELS[stageKey]}
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
