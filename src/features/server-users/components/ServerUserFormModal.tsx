import { Modal } from '@/components/ui'
import type { ServerUserOut } from '@/lib/contracts'
import { useCreateServerUser, useUpdateServerUser } from '../hooks/use-server-user-mutations'
import {
  ServerUserForm,
  toServerUserCreate,
  toServerUserUpdate,
  type ServerUserFormValues,
} from './ServerUserForm'

interface ServerUserFormModalProps {
  open: boolean
  onClose: () => void
  user?: ServerUserOut
  defaultServerId?: number
  serverName?: string
}

export function ServerUserFormModal({
  open,
  onClose,
  user,
  defaultServerId,
  serverName,
}: ServerUserFormModalProps) {
  const create = useCreateServerUser()
  const update = useUpdateServerUser(user?.id ?? 0)
  const isSubmitting = create.isPending || update.isPending

  const handleSubmit = (values: ServerUserFormValues) => {
    if (user) {
      update.mutate(
        { body: toServerUserUpdate(values), provision: values.provision },
        { onSuccess: onClose },
      )
    } else {
      create.mutate(
        { body: toServerUserCreate(values), provision: values.provision },
        { onSuccess: onClose },
      )
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? 'Editar usuario del motor' : 'Crear usuario del motor'}
      description={
        user
          ? 'Actualiza la contraseña, notas o estado del usuario.'
          : 'Crea un usuario propietario. Con aprovisionar, se ejecuta CREATE USER en el motor.'
      }
      size="lg"
    >
      <ServerUserForm
        mode={user ? 'edit' : 'create'}
        defaultValues={
          user
            ? { is_active: user.is_active, notes: user.notes ?? '', password: '', provision: false }
            : { server_id: defaultServerId ?? 0 }
        }
        readonlyIdentity={
          user ? { username: user.username, host: user.host ?? null, serverName } : undefined
        }
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  )
}
