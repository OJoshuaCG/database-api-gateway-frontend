import { Callout, ConfirmDialog } from '@/components/ui'
import { CapabilityHint, useCapabilityGuard } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import { CAPABILITIES, type DatabaseModelOut } from '@/lib/contracts'
import { useDeleteDatabaseModel } from '../hooks/use-database-models'
import { modelInUseText } from '../model-in-use'

interface DeleteDatabaseModelDialogProps {
  /** `null` = cerrado. Se monta con el blueprint para que el diálogo nazca con su nombre. */
  model: DatabaseModelOut | null
  onClose: () => void
  /**
   * Tras el 2xx, además de cerrar. Lo usa la página del blueprint para salir de una ruta que
   * acaba de dejar de existir; el catálogo no lo necesita, porque la fila desaparece sola.
   */
  onDeleted?: () => void
}

/**
 * Confirmación del borrado de un blueprint: **la única implementación de «Eliminar blueprint»**.
 *
 * Regla R1 de la app: la vista propia de una entidad (su página) tiene todas sus acciones, y las
 * filas de otros listados son atajos de esas MISMAS acciones. Por eso este diálogo vive aparte y
 * lo montan tanto el catálogo (pestaña «Blueprints») como la cabecera de la página del
 * blueprint: si cada vista escribiera su propio `ConfirmDialog`, el texto y el comportamiento
 * divergirían en la siguiente actualización, que es justo lo que pasó con el de servidores.
 *
 * Sin `confirmWord`: el borrado es del inventario del gateway y no toca ningún motor. El texto lo
 * dice para que el operador no lo confunda con un `DROP DATABASE`.
 *
 * Pide `blueprints.apply`, no `write` (v23 §4.1): se lleva TODAS las versiones y, con ellas, el
 * `down_sql` con el que se revierte cualquier base. Sin destino (`SCOPE_EXEMPT`: solo se puede
 * borrar cuando ninguna base lo usa), así que la guarda va sin `scope`. Mientras alguna base
 * gestionada lo use, el backend responde 409 `database_model.in_use` y el diálogo lo explica acá
 * mismo nombrando esas bases, en vez de un toast que se va antes de que se lean.
 */
export function DeleteDatabaseModelDialog({
  model,
  onClose,
  onDeleted,
}: DeleteDatabaseModelDialogProps) {
  const remove = useDeleteDatabaseModel()
  const guard = useCapabilityGuard(CAPABILITIES.blueprintsApply, 'eliminar blueprints')
  if (!model) return null

  const inUse = remove.error ? modelInUseText(toApiError(remove.error)) : null
  // El catálogo deja este diálogo montado entre aperturas (`model: null` = cerrado), así que la
  // mutación sobrevive: sin `reset`, el 409 de un blueprint aparecería al abrir el de otro.
  const close = () => {
    remove.reset()
    onClose()
  }

  return (
    <ConfirmDialog
      open
      onClose={close}
      onConfirm={() =>
        remove.mutate(model.id, {
          onSuccess: () => {
            close()
            onDeleted?.()
          },
        })
      }
      title="Eliminar blueprint"
      description={`Se eliminará «${model.name}» con todas sus versiones. Solo se puede si ninguna base gestionada lo usa; ninguna base de datos se modifica.`}
      confirmLabel="Eliminar"
      isLoading={remove.isPending}
      // Con el 409 a la vista, reintentar daría el mismo 409: primero hay que mover esas bases.
      confirmDisabled={!guard.allowed || inUse !== null}
      confirmDescribedBy={guard.describedBy}
    >
      <CapabilityHint guard={guard} />
      {inUse && (
        <Callout tone="warning" title="El blueprint está en uso">
          <p>{inUse}</p>
        </Callout>
      )}
    </ConfirmDialog>
  )
}
