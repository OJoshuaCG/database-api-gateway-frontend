import { Button, ConfirmDialog, Modal } from '@/components/ui'
import { useCapabilityGuard } from '@/features/auth'
import { CAPABILITIES } from '@/lib/contracts'
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
 *
 * Exige `engine_users.drop`, igual que el interruptor de DROP de `DeleteServerUserDialog`. Sin
 * la capacidad no se ofrece la confirmación: el operador escribiría el nombre para recién ahí
 * comerse un 403. Se explica el motivo, visible, en su lugar.
 */
export function DeleteEngineUserDialog({
  onClose,
  serverId,
  username,
  host,
}: DeleteEngineUserDialogProps) {
  const deleteUser = useDeleteEngineUser(serverId)
  const dropGuard = useCapabilityGuard(CAPABILITIES.engineUsersDrop, 'eliminar usuarios del motor')

  if (!dropGuard.allowed) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Eliminar usuario del motor 🔌"
        size="sm"
        footer={
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">{dropGuard.hint}</p>
      </Modal>
    )
  }

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
      title="Eliminar usuario del motor 🔌"
      description={`Se ejecutará DROP USER sobre «${username}${host ? `@${host}` : ''}» en el servidor destino. Esta acción es irreversible. Si el usuario posee bases de datos gestionadas, deberás reasignarlas o eliminarlas primero.`}
      confirmWord={username}
      confirmLabel="Eliminar del motor 🔌"
      isLoading={deleteUser.isPending}
    />
  )
}
