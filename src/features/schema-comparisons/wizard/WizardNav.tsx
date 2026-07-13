import type { ReactNode } from 'react'
import { Button } from '@/components/ui'
import type { SchemaComparisonWizard } from './use-schema-comparison-wizard'

/**
 * Barra de navegación del asistente, fuera del `<Card>` y fija al pie (`sticky bottom-0
 * mt-auto`) — mismo patrón que `snapshot-wizard/WizardNav.tsx`: la posición queda estable
 * aunque la altura del contenido varíe entre pasos. Los pasos con acciones ricas
 * (`summary`, `result`) devuelven `null`: esos cuerpos ya incluyen sus propios CTAs con la
 * explicación contextual que no cabe en esta barra genérica.
 */
export function WizardNav({ wizard }: { wizard: SchemaComparisonWizard }) {
  const busy = wizard.createComparisonState.isPending || wizard.adopt.isPending || wizard.execute.isPending

  let left: ReactNode = null
  let right: ReactNode = null

  switch (wizard.step) {
    case 'selector':
      right = (
        <Button
          onClick={wizard.createComparison}
          isLoading={wizard.createComparisonState.isPending}
          disabled={
            wizard.sourceId == null || wizard.targetId == null || wizard.createComparisonState.isPending
          }
        >
          {wizard.createComparisonState.isPending ? 'Calculando diferencias…' : 'Calcular diferencias →'}
        </Button>
      )
      break

    // El cuerpo de la vista ya trae "Ver detalle del DDL", los CTA de rama A/B y "Recalcular".
    case 'summary':
      return null

    case 'items':
      left = (
        <Button variant="ghost" onClick={wizard.back}>
          ← Volver al resumen
        </Button>
      )
      right = wizard.actionEntryStep && (
        <Button onClick={() => wizard.goToStep(wizard.actionEntryStep!)}>Continuar a la acción →</Button>
      )
      break

    case 'adoptSelect':
      left = <BackButton wizard={wizard} disabled={busy} />
      right = (
        <Button onClick={wizard.next} disabled={wizard.selectedItemIds.size === 0}>
          Continuar →
        </Button>
      )
      break

    case 'adoptConfirm': {
      const disabled =
        busy ||
        wizard.actionCooldown ||
        wizard.adoptName.trim().length === 0 ||
        wizard.pendingReviewIds.length > 0
      left = <BackButton wizard={wizard} disabled={busy} />
      right = (
        <Button onClick={wizard.submitAdopt} isLoading={wizard.adopt.isPending} disabled={disabled}>
          {wizard.adoptExecuteImmediately ? 'Adoptar y aplicar 🔌' : 'Adoptar versión'}
        </Button>
      )
      break
    }

    case 'executeSelect':
      left = <BackButton wizard={wizard} disabled={busy} />
      right = (
        <Button
          onClick={wizard.next}
          disabled={wizard.executeMode === 'custom' && wizard.selectedItemIds.size === 0}
        >
          Continuar →
        </Button>
      )
      break

    case 'executeConfirm': {
      const nameMatches =
        wizard.confirmTargetName.length > 0 && wizard.confirmTargetName === wizard.targetDetail.data?.name
      const disabled =
        busy ||
        wizard.actionCooldown ||
        !wizard.preview.data ||
        wizard.preview.isFetching ||
        !nameMatches ||
        wizard.pendingReviewIds.length > 0
      left = <BackButton wizard={wizard} disabled={busy} />
      right = (
        <Button onClick={wizard.submitExecute} isLoading={wizard.execute.isPending} disabled={disabled}>
          Ejecutar sobre el target 🔌
        </Button>
      )
      break
    }

    // 'result' es terminal: sus acciones viven en el propio paso.
    case 'result':
      return null
  }

  return (
    <div className="sticky bottom-0 z-10 mt-auto flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-elevated">
      {left ?? <span aria-hidden />}
      <div className="flex flex-wrap justify-end gap-2">{right}</div>
    </div>
  )
}

function BackButton({ wizard, disabled }: { wizard: SchemaComparisonWizard; disabled?: boolean }) {
  return (
    <Button variant="ghost" onClick={wizard.back} disabled={disabled}>
      ← Atrás
    </Button>
  )
}
