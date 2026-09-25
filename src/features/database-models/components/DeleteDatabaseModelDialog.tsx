import { ConfirmDialog } from '@/components/ui'
import type { DatabaseModelOut } from '@/lib/contracts'
import { useDeleteDatabaseModel } from '../hooks/use-database-models'

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
 */
export function DeleteDatabaseModelDialog({
  model,
  onClose,
  onDeleted,
}: DeleteDatabaseModelDialogProps) {
  const remove = useDeleteDatabaseModel()
  if (!model) return null

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() =>
        remove.mutate(model.id, {
          onSuccess: () => {
            onClose()
            onDeleted?.()
          },
        })
      }
      title="Eliminar blueprint"
      description={`Se eliminará «${model.name}». Las bases de datos asociadas no se modifican.`}
      confirmLabel="Eliminar"
      isLoading={remove.isPending}
    />
  )
}
