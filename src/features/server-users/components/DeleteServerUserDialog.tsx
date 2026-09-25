import { useState } from 'react'
import { ConfirmDialog, Switch } from '@/components/ui'
import { useCapabilityGuard } from '@/features/auth'
import { CAPABILITIES, type ServerUserOut } from '@/lib/contracts'
import { useDeleteServerUser } from '../hooks/use-server-user-mutations'

interface DeleteServerUserDialogProps {
  /** Montar este componente solo cuando hay un usuario objetivo (estado fresco por apertura). */
  user: ServerUserOut
  onClose: () => void
}

/**
 * Quitar un usuario del inventario. Por defecto NO toca el motor; si se activa `drop_remote`,
 * además ejecuta DROP USER y exige reescribir el username exacto (doble confirmación, §7). Un
 * usuario que posee BDs no puede borrarse (409). Título y botón cambian con el interruptor para
 * nombrar siempre la consecuencia real (R5).
 */
export function DeleteServerUserDialog({ user, onClose }: DeleteServerUserDialogProps) {
  const [dropRemote, setDropRemote] = useState(false)
  const deleteUser = useDeleteServerUser()
  // `drop_remote=true` SUBE el requisito (v23 §4): borrar del inventario pide `engine_users.write`,
  // pero ejecutar el DROP en el motor pide `engine_users.drop`. Sin esto, el operador llena el
  // diálogo, confirma reescribiendo el nombre y recién ahí se come un 403.
  const dropGuard = useCapabilityGuard(CAPABILITIES.engineUsersDrop, 'eliminar usuarios del motor')

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => {
        deleteUser.mutate(
          {
            id: user.id,
            serverId: user.server_id,
            dropRemote,
            confirmUsername: dropRemote ? user.username : undefined,
          },
          { onSuccess: onClose },
        )
      }}
      title={dropRemote ? 'Eliminar usuario del motor 🔌' : 'Quitar usuario del inventario'}
      description={
        dropRemote
          ? 'Se ejecutará DROP USER en el servidor destino. Esta acción es irreversible.'
          : 'Se eliminará del inventario; el usuario seguirá existiendo en el motor.'
      }
      confirmWord={dropRemote ? user.username : undefined}
      confirmLabel={dropRemote ? 'Eliminar del motor 🔌' : 'Quitar del inventario'}
      isLoading={deleteUser.isPending}
    >
      <Switch
        checked={dropRemote}
        onCheckedChange={setDropRemote}
        disabled={!dropGuard.allowed}
        label="Eliminar también del motor (DROP USER) 🔌"
        hint={dropGuard.hint ?? 'Requiere reescribir el nombre del usuario para confirmar.'}
      />
    </ConfirmDialog>
  )
}
