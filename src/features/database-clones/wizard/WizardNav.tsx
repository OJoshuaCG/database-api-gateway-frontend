import type { ReactNode } from 'react'
import { Button } from '@/components/ui'
import type { DatabaseCloneWizard } from './use-database-clone-wizard'

/**
 * Barra de navegación del asistente, fuera del `<Card>` y fija al pie (`sticky bottom-0 mt-auto`)
 * — mismo patrón que schema-comparisons/snapshot-wizard. Los pasos con acciones ricas propias
 * (`summary`, `monitor`) devuelven `null`: su cuerpo ya trae los CTAs contextuales.
 */
export function WizardNav({ wizard }: { wizard: DatabaseCloneWizard }) {
  const busy = wizard.createClone.isPending || wizard.execute.isPending

  let left: ReactNode = null
  let right: ReactNode = null

  switch (wizard.step) {
    // El cuerpo ya trae los botones de reentrada (seleccionar / previsualizar / monitor).
    case 'summary':
      return null

    case 'plan':
      if (wizard.jobId != null) left = <BackButton wizard={wizard} disabled={busy} onClick={() => wizard.goToStep('summary')} />
      right = (
        <Button onClick={wizard.createPlan} isLoading={wizard.createClone.isPending} disabled={wizard.createPlanDisabled}>
          {wizard.createClone.isPending ? 'Creando plan…' : 'Crear plan →'}
        </Button>
      )
      break

    case 'selection':
      left = <BackButton wizard={wizard} disabled={busy} onClick={() => wizard.goToStep('plan')} />
      right = (
        <Button
          onClick={wizard.confirmSelection}
          disabled={wizard.checkedSelection.size === 0 || wizard.closure.isStale}
        >
          {wizard.closure.isStale ? 'Resolviendo dependencias…' : 'Previsualizar selección →'}
        </Button>
      )
      break

    case 'preview': {
      const nameMatches =
        wizard.confirmTargetName.length > 0 && wizard.confirmTargetName === wizard.job.data?.target_database_name
      const disabled =
        busy ||
        wizard.actionCooldown ||
        !wizard.preview.data ||
        wizard.preview.isFetching ||
        !nameMatches
      left = (
        <BackButton
          wizard={wizard}
          disabled={busy}
          onClick={() => wizard.goToStep(wizard.plan.planMode === 'partial' ? 'selection' : 'plan')}
        />
      )
      right = (
        <Button onClick={wizard.submitExecute} isLoading={wizard.execute.isPending} disabled={disabled}>
          Ejecutar clonación 🔌
        </Button>
      )
      break
    }

    // 'monitor' es terminal: cancelar y las acciones de desenlace viven en el propio paso.
    case 'monitor':
      return null
  }

  return (
    <div className="sticky bottom-0 z-10 mt-auto flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-elevated">
      {left ?? <span aria-hidden />}
      <div className="flex flex-wrap justify-end gap-2">{right}</div>
    </div>
  )
}

function BackButton({
  wizard,
  disabled,
  onClick,
}: {
  wizard: DatabaseCloneWizard
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <Button variant="ghost" onClick={onClick ?? wizard.back} disabled={disabled}>
      ← Atrás
    </Button>
  )
}
