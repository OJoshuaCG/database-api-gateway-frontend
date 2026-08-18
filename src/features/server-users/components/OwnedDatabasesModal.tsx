import { Modal } from '@/components/ui'
import type { ServerUserOut } from '@/lib/contracts'
import { OwnedDatabasesContent } from './OwnedDatabasesContent'

interface OwnedDatabasesModalProps {
  user: ServerUserOut | null
  onClose: () => void
}

/**
 * Modal delgado alrededor de `OwnedDatabasesContent` (§7), usado desde `ServerUsersPage` —el
 * listado cross-servidor, que no tiene una ficha propia por fila. En la ficha de usuario del
 * motor (`ServerUserDetailPage`) el mismo contenido se embebe directo, sin este modal.
 */
export function OwnedDatabasesModal({ user, onClose }: OwnedDatabasesModalProps) {
  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title="Bases de datos del usuario"
      description={user ? `Propiedad de ${user.username}` : undefined}
    >
      {user && <OwnedDatabasesContent userId={user.id} />}
    </Modal>
  )
}
