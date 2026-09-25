import type { ReactNode } from 'react'
import { Button } from '@/components/ui'
import { useLinkProjectBlueprints } from '../hooks/use-projects'

interface UnlinkUndoBarProps {
  projectId: number
  modelId: number
  /**
   * La frase de lo que pasó. Es lo único que cambia según desde dónde se quitó: en el detalle de
   * un proyecto el protagonista es el blueprint («X quitado del proyecto»), y en la página de un
   * blueprint es el proyecto («Quitado de Y»). El comportamiento es el mismo.
   */
  children: ReactNode
  onDone: () => void
}

/**
 * Barra de «Deshacer» tras quitar un blueprint de un proyecto. **Una sola**, para las dos entradas
 * —el detalle del proyecto y la página del blueprint—, que llegaron a tener cada una la suya: una
 * copia no falla, se desincroniza, y la divergencia típica es que una de las dos entradas pierde
 * el deshacer, que es exactamente lo que había pasado.
 *
 * Quitar no borra el blueprint, solo el vínculo, así que deshacer es volver a vincularlo. Repetir
 * el deshacer es inofensivo: la vinculación es idempotente y el id repetido vuelve en
 * `already_linked`, así que no hay carrera que proteger.
 *
 * El hook está parametrizado con el proyecto: quien la monta tiene que ponerle `key` por proyecto
 * para que un segundo «Quitar» estrene hook en vez de heredar el `isPending` del anterior.
 */
export function UnlinkUndoBar({ projectId, modelId, children, onDone }: UnlinkUndoBarProps) {
  const relink = useLinkProjectBlueprints(projectId)

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
      <span>{children}</span>
      <Button
        variant="outline"
        size="sm"
        isLoading={relink.isPending}
        onClick={() => relink.mutate([modelId], { onSuccess: onDone })}
      >
        Deshacer
      </Button>
    </div>
  )
}
