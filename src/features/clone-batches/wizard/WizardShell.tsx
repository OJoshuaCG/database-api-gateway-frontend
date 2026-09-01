import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { BatchStep, CloneBatchWizard } from './use-clone-batch-wizard'

/**
 * Indicador de pasos + barra de acciones del asistente de lotes.
 *
 * Va en un solo archivo (y no en `WizardStepper` + `WizardNav` como en los otros asistentes)
 * porque el CTA de cada paso y su etiqueta en el indicador son la misma decisión: partirlos
 * obliga a repetir el `switch` sobre el paso en dos lugares que tienen que coincidir.
 */
const STEP_LABELS: Record<BatchStep, string> = {
  plan: 'Servidores',
  databases: 'Bases',
  confirm: 'Confirmar',
  monitor: 'Seguimiento',
}

export function WizardStepper({ wizard }: { wizard: CloneBatchWizard }) {
  const actual = wizard.order.indexOf(wizard.step)
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {wizard.order.map((step, index) => {
        const estado = index < actual ? 'hecho' : index === actual ? 'actual' : 'pendiente'
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium',
                estado === 'actual' && 'bg-primary text-primary-foreground',
                estado === 'hecho' && 'bg-success/15 text-success',
                estado === 'pendiente' && 'bg-surface-muted text-muted-foreground',
              )}
            >
              {index + 1}. {STEP_LABELS[step]}
            </span>
            {index < wizard.order.length - 1 && (
              <span aria-hidden className="text-muted-foreground">
                ›
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function WizardNav({ wizard }: { wizard: CloneBatchWizard }) {
  let left: React.ReactNode = null
  let right: React.ReactNode = null

  switch (wizard.step) {
    case 'plan':
      right = (
        <Button
          onClick={() => wizard.goToStep('databases')}
          disabled={wizard.plan.sourceServerId == null || wizard.plan.targetServerId == null}
        >
          Elegir bases →
        </Button>
      )
      break

    case 'databases':
      left = (
        <Button variant="ghost" onClick={() => wizard.goToStep('plan')}>
          ← Servidores
        </Button>
      )
      right = (
        <Button
          onClick={wizard.submitPlan}
          isLoading={wizard.createBatch.isPending}
          // `createBody` es `null` mientras el plan no sea enviable: sin filas, con nombres
          // repetidos, con un nombre vacío o con una fila que pide un modo no representable.
          disabled={wizard.createBody == null || wizard.createBatch.isPending}
        >
          Revisar el lote →
        </Button>
      )
      break

    case 'confirm':
      left = (
        <Button variant="ghost" onClick={() => wizard.goToStep('databases')}>
          ← Bases
        </Button>
      )
      right = (
        <Button
          onClick={wizard.submitExecute}
          isLoading={wizard.execute.isPending}
          disabled={!wizard.confirmMatches || wizard.execute.isPending || !wizard.batch.data}
        >
          Clonar {wizard.batch.data?.total ?? 0} bases 🔌
        </Button>
      )
      break

    case 'monitor':
      // Terminal: cancelar y las acciones de desenlace viven dentro del propio paso.
      break
  }

  if (!left && !right) return null
  return (
    <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-surface px-1 py-3">
      <div>{left}</div>
      <div>{right}</div>
    </div>
  )
}
