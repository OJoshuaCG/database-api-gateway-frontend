import { Callout, ConfirmDialog } from '@/components/ui'
import { scopeHasGrantsMessage } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import type { ServerOut } from '@/lib/contracts'
import { useDeleteServer } from '../hooks/use-server-mutations'

const BLOCKED_ID = 'delete-server-blocked'

interface DeleteServerDialogProps {
  /** `null` = cerrado. Se monta con el servidor para que el diálogo nazca con su nombre. */
  server: ServerOut | null
  onClose: () => void
  /**
   * Tras el 2xx, además de cerrar. Lo usa el detalle para salir de una ruta que acaba de dejar de
   * existir; el listado no lo necesita, porque la fila desaparece sola.
   */
  onDeleted?: () => void
}

/**
 * Confirmación del borrado de un servidor: **la única implementación de «Eliminar servidor»**.
 *
 * Regla R1 de la app: la vista propia de una entidad (su página) tiene todas sus acciones, y las
 * filas de otros listados son atajos de esas MISMAS acciones. Este diálogo estuvo copiado en el
 * listado y en el detalle, y las dos copias ya habían divergido en el texto; por eso ahora hay
 * una sola y la montan los dos.
 *
 * El texto insiste en «del gateway» a propósito: el borrado quita el registro del inventario y
 * NO toca el motor. Sin esa precisión, «eliminar servidor» se lee como algo mucho más grave.
 */
export function DeleteServerDialog({ server, onClose, onDeleted }: DeleteServerDialogProps) {
  const remove = useDeleteServer()
  if (!server) return null

  // El 409 `access.scope_has_grants` no se arregla reintentando: hay que quitar los accesos desde
  // la página de cada usuario. Por eso se queda a la vista en el diálogo (el toast se va solo) y
  // deshabilita «Eliminar» hasta cerrarlo.
  const blocked = remove.error ? scopeHasGrantsMessage(toApiError(remove.error), 'server') : null

  // El diálogo queda montado entre servidores (devuelve `null`, no se desmonta), así que el error
  // de un intento se limpia al cerrar: si no, el siguiente servidor nacería bloqueado.
  const close = () => {
    remove.reset()
    onClose()
  }

  return (
    <ConfirmDialog
      open
      onClose={close}
      onConfirm={() =>
        remove.mutate(server.id, {
          onSuccess: () => {
            close()
            onDeleted?.()
          },
        })
      }
      title="Eliminar servidor del inventario"
      description={`Se eliminará «${server.name}» del inventario del gateway. Los objetos del motor destino no se modifican.`}
      confirmLabel="Eliminar"
      isLoading={remove.isPending}
      confirmDisabled={blocked !== null}
      confirmDescribedBy={blocked ? BLOCKED_ID : undefined}
    >
      {blocked && (
        <Callout id={BLOCKED_ID} tone="warning" title="Todavía hay accesos sobre este servidor">
          {blocked}
        </Callout>
      )}
    </ConfirmDialog>
  )
}
