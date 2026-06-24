import { useState } from 'react'
import { ConfirmDialog, Switch } from '@/components/ui'
import type { ServerUserOut } from '@/lib/contracts'
import { useDeleteServerUser } from '../hooks/use-server-user-mutations'

interface DeleteServerUserDialogProps {
  /** Montar este componente solo cuando hay un usuario objetivo (estado fresco por apertura). */
  user: ServerUserOut
  onClose: () => void
}

/**
 * Borrado de usuario. Si se activa `drop_remote`, exige reescribir el username exacto
 * (doble confirmación, §7). Un usuario que posee BDs no puede borrarse (409).
 */
export function DeleteServerUserDialog({ user, onClose }: DeleteServerUserDialogProps) {
  const [dropRemote, setDropRemote] = useState(false)
  const deleteUser = useDeleteServerUser()

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => {
        deleteUser.mutate(
          { id: user.id, dropRemote, confirmUsername: dropRemote ? user.username : undefined },
          { onSuccess: onClose },
        )
      }}
      title="Eliminar usuario del motor"
      description={
        dropRemote
          ? 'Se ejecutará DROP USER en el servidor destino. Esta acción es irreversible.'
          : 'Se eliminará del inventario; el usuario seguirá existiendo en el motor.'
      }
      confirmWord={dropRemote ? user.username : undefined}
      confirmLabel="Eliminar"
      isLoading={deleteUser.isPending}
    >
      <Switch
        checked={dropRemote}
        onCheckedChange={setDropRemote}
        label="Eliminar también del motor (DROP USER) 🔌"
        hint="Requiere reescribir el nombre del usuario para confirmar."
      />
    </ConfirmDialog>
  )
}
