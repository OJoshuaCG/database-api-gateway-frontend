import type { ReactNode } from 'react'
import { Button, ChevronLeftIcon, IconButton } from '@/components/ui'
import type { DatabaseExportWizard } from './use-database-export-wizard'

/**
 * Barra de navegación del asistente, fuera del `<Card>` y fija al pie (`sticky bottom-0 mt-auto`)
 * — mismo patrón que database-clones y schema-comparisons.
 *
 * Los pasos `confirm` y `monitor` devuelven `null`: sus CTAs viven en el cuerpo porque tienen que
 * estar junto a lo que los habilita (el botón de exportar, pegado al campo del nombre re-tecleado;
 * las acciones del desenlace, pegadas al artefacto). Un botón de exportar en la barra estaría a un
 * scroll de distancia del control que lo desbloquea.
 */
export function WizardNav({ wizard }: { wizard: DatabaseExportWizard }) {
  let left: ReactNode = null
  let right: ReactNode = null

  switch (wizard.step) {
    case 'origin':
      /**
       * El plan se crea acá y no al final porque el catálogo de objetos (`GET .../objects`) cuelga
       * del job: sin plan creado no hay nada que listar en el paso 2. La contrapartida —un plan que
       * quizá nunca se ejecute— es barata: un plan no toca el motor y vence solo a las 24 h.
       */
      right = (
        <Button
          onClick={wizard.submitPlan}
          isLoading={wizard.createPlan.isPending}
          disabled={wizard.spec == null || wizard.createPlan.isPending || wizard.actionCooldown}
        >
          {wizard.createPlan.isPending ? 'Creando plan…' : 'Continuar →'}
        </Button>
      )
      break

    case 'objects':
      left = <BackButton onClick={wizard.back} />
      right = (
        <Button
          onClick={wizard.next}
          // Mientras el cierre de dependencias describe una selección ANTERIOR, avanzar dejaría
          // fuera objetos que el usuario sí marcó —en silencio y sin ningún error—, porque lo que
          // viaja al backend es el cierre, no las casillas.
          disabled={wizard.closure.isStale}
        >
          {wizard.closure.isStale ? 'Resolviendo dependencias…' : 'Continuar →'}
        </Button>
      )
      break

    case 'options':
      left = <BackButton onClick={wizard.back} />
      right = (
        <Button onClick={wizard.next} disabled={wizard.hasBlockingViolations}>
          Continuar →
        </Button>
      )
      break

    // El cuerpo trae el botón de exportar junto al nombre re-tecleado.
    case 'confirm':
      return null

    // 'monitor' es terminal: cancelar, descargar y copiar viven junto al artefacto.
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
