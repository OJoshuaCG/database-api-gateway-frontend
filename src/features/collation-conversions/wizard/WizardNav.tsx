import type { ReactNode } from 'react'
import { Button, ChevronLeftIcon, IconButton } from '@/components/ui'
import type { CollationConversionWizard } from './use-collation-conversion-wizard'

/**
 * Barra de navegación del asistente, fuera del `<Card>` y fija al pie (`sticky bottom-0 mt-auto`)
 * — mismo patrón que `database-clones`/schema-comparisons/snapshot-wizard.
 *
 * `summary` y `monitor` devuelven `null`: su cuerpo ya trae los CTAs contextuales (reentrada y
 * cancelación/resultado, respectivamente). `preview` TAMBIÉN devuelve `null` a propósito, aunque
 * en `database-clones` sí tiene botón acá: acá la confirmación de dos factores es un `ConfirmDialog`
 * (modal) que `PreviewStep` abre y controla por completo, junto con su propio botón "← Volver a
 * la selección" (§6.3 del doc) — meterlo en esta barra genérica hubiera exigido coordinar el
 * estado de apertura del modal entre dos componentes sin necesidad real.
 */
export function WizardNav({ wizard }: { wizard: CollationConversionWizard }) {
  let left: ReactNode = null
  let right: ReactNode = null

  switch (wizard.step) {
    // El cuerpo ya trae los botones de reentrada (inventario / vista previa / monitor).
    case 'summary':
      return null

    case 'plan': {
      const hasCollation = wizard.targetCollation.trim().length > 0
      const hasCharset = (wizard.targetCharset ?? '').trim().length > 0
      const ready = hasCollation && (wizard.mode === 'columns' || hasCharset)
      const disabled = !ready || wizard.createPlan.isPending || wizard.actionCooldown > 0
      if (wizard.jobId != null) {
        left = <BackButton onClick={() => wizard.goToStep('summary')} disabled={wizard.createPlan.isPending} />
      }
      right = (
        <Button
          onClick={() =>
            wizard.createPlan.mutate({
              // `columns` (PostgreSQL) nunca manda charset: es 422 garantizado si se envía.
              target_charset: wizard.mode === 'columns' ? null : wizard.targetCharset,
              target_collation: wizard.targetCollation,
            })
          }
          isLoading={wizard.createPlan.isPending}
          disabled={disabled}
        >
          {wizard.createPlan.isPending ? 'Creando plan…' : 'Crear plan →'}
        </Button>
      )
      break
    }

    case 'inventory':
      left = <BackButton onClick={() => wizard.goToStep('plan')} />
      right = (
        <Button onClick={wizard.next} disabled={wizard.objects.isLoading || !wizard.objects.data}>
          Previsualizar plan →
        </Button>
      )
      break

    // El footer completo (advertencias, pasos, ConfirmDialog, botón de ejecutar) vive en
    // PreviewStep — ver el comentario de arriba.
    case 'preview':
      return null

    // Terminal: cancelar y las acciones de desenlace (replanear/salir) viven en el propio paso.
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

function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <IconButton
      label="Atrás"
      icon={<ChevronLeftIcon />}
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
    />
  )
}
