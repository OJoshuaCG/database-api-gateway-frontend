import { ConfirmDialog } from '@/components/ui'
import { useDeleteEngineUser } from '../hooks/use-engine-users'

interface DeleteEngineUserDialogProps {
  onClose: () => void
  serverId: number
  username: string
  host?: string | null
}

/**
 * `DROP USER/ROLE` 🔌 — irreversible. `ConfirmDialog` exige reescribir el username exacto
 * (doble intención) antes de habilitar el botón, igual que el DELETE del inventario. Si el
 * usuario posee BDs gestionadas, el backend responde 409 (reasignar/eliminar esas BDs primero).
 */
export function DeleteEngineUserDialog({
  onClose,
  serverId,
  username,
  host,
}: DeleteEngineUserDialogProps) {
  const deleteUser = useDeleteEngineUser(serverId)

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() =>
        deleteUser.mutate(
          { username, host: host ?? undefined, confirmUsername: username },
          { onSuccess: onClose },
        )
      }
      title="Eliminar usuario del motor"
      description={`Se ejecutará DROP USER sobre «${username}${host ? `@${host}` : ''}» en el servidor destino. Esta acción es irreversible. Si el usuario posee bases de datos gestionadas, deberás reasignarlas o eliminarlas primero.`}
      confirmWord={username}
      confirmLabel="Eliminar"
      isLoading={deleteUser.isPending}
    />
  )
}
