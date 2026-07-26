import { Modal } from '@/components/ui'
import type { EngineType, ServerUserOut } from '@/lib/contracts'
import { useCreateServerUser, useUpdateServerUser } from '../hooks/use-server-user-mutations'
import { useProvisionServerUser } from '../hooks/use-provision-server-user'
import {
  ServerUserForm,
  toInitialGrant,
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
  const provision = useProvisionServerUser()
  const isSubmitting = create.isPending || update.isPending || provision.isPending

  const handleSubmit = (values: ServerUserFormValues, engine: EngineType | null) => {
    if (user) {
      update.mutate(
        { body: toServerUserUpdate(values), provision: values.provision },
        { onSuccess: onClose },
      )
      return
    }
    // Con permisos iniciales, `POST /server-users/provision` crea + aprovisiona + otorga en una
    // sola llamada (§7); sin ellos se conserva el camino clásico `POST /server-users?provision=`.
    const initialGrant = values.provision ? toInitialGrant(values, engine) : null
    if (initialGrant) {
      provision.mutate(
        { ...toServerUserCreate(values, engine), initial_grants: [initialGrant] },
        { onSuccess: onClose },
      )
    } else {
      create.mutate(
        { body: toServerUserCreate(values, engine), provision: values.provision },
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
