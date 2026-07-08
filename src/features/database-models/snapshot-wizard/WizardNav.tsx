import type { ReactNode } from 'react'
import { Button } from '@/components/ui'
import type { SnapshotWizard } from './use-snapshot-wizard'

/**
 * Barra de navegación del asistente, **fuera del card** y fija al pie (`sticky`): así los botones
 * Atrás/Continuar quedan en una posición estable aunque la altura del card varíe entre pasos —
 * siempre visibles sin scroll en pasos largos, y al final del contenido en pasos cortos. La lógica
 * de cada paso (habilitado, etiquetas, envío) se lee del estado central `wizard`.
 */
export function WizardNav({ wizard }: { wizard: SnapshotWizard }) {
  const busy = wizard.create.isPending

  let left: ReactNode = null
  let right: ReactNode = null

  switch (wizard.step) {
    case 'origin':
      right = (
        <Button onClick={wizard.next} disabled={!wizard.serverId || !wizard.database}>
          Ver estructura →
        </Button>
      )
      break

    case 'preview': {
      // La barra solo aplica al estado con datos; carga/error/vacío se resuelven en el cuerpo.
      const ready = Boolean(wizard.snapshot.data) && (wizard.snapshot.data?.statements.length ?? 0) > 0
      if (!ready) return null
      left = (
        <Button variant="ghost" onClick={wizard.back} disabled={busy}>
          ← Cambiar origen
        </Button>
      )
      right = (
        <>
          <Button variant="primary" onClick={wizard.submitExpress} isLoading={busy}>
            Crear con valores por defecto
          </Button>
          <Button variant="outline" onClick={wizard.next} disabled={busy}>
            Personalizar →
          </Button>
        </>
      )
      break
    }

    case 'objects':
      left = <BackButton wizard={wizard} />
      right = (
        <Button onClick={wizard.next} disabled={wizard.selectedStatements.length === 0}>
          Continuar →
        </Button>
      )
      break

    case 'layout':
      left = <BackButton wizard={wizard} />
      right = <Button onClick={wizard.next}>Continuar →</Button>
      break

    case 'manual':
      left = <BackButton wizard={wizard} />
      right = (
        <Button onClick={wizard.next} disabled={wizard.manualProblems.length > 0}>
          Continuar →
        </Button>
      )
      break

    case 'data':
      left = <BackButton wizard={wizard} />
      right = (
        <Button onClick={wizard.next}>
          {wizard.dataCount > 0 ? 'Continuar →' : 'Continuar sin datos →'}
        </Button>
      )
      break

    case 'summary':
      left = <BackButton wizard={wizard} />
      right = (
        <Button
          onClick={wizard.submit}
          isLoading={busy}
          disabled={busy || !wizard.name.trim() || !wizard.slugValid}
        >
          Crear blueprint
        </Button>
      )
      break

    // 'result' es una pantalla terminal: sus acciones viven en el propio paso.
    case 'result':
      return null
  }

  return (
    // `mt-auto`: en pasos cortos absorbe el espacio libre y ancla la barra al pie (posición
    // estable). `sticky bottom-0`: en pasos largos la mantiene visible mientras se hace scroll.
    <div className="sticky bottom-0 z-10 mt-auto flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-elevated">
      {left ?? <span aria-hidden />}
      <div className="flex flex-wrap justify-end gap-2">{right}</div>
    </div>
  )
}

function BackButton({ wizard }: { wizard: SnapshotWizard }) {
  return (
    <Button variant="ghost" onClick={wizard.back} disabled={wizard.create.isPending}>
      ← Atrás
    </Button>
  )
}
