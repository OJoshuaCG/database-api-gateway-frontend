import { Modal } from '@/components/ui'
import type { PermissionProfileOut } from '@/lib/contracts'
import {
  useCreatePermissionProfile,
  useUpdatePermissionProfile,
} from '../hooks/use-permission-profiles'
import {
  PermissionProfileForm,
  toCreate,
  toUpdate,
  type PermissionProfileFormValues,
} from './PermissionProfileForm'

interface PermissionProfileFormModalProps {
  open: boolean
  onClose: () => void
  profile?: PermissionProfileOut
}

export function PermissionProfileFormModal({
  open,
  onClose,
  profile,
}: PermissionProfileFormModalProps) {
  const create = useCreatePermissionProfile()
  const update = useUpdatePermissionProfile(profile?.id ?? 0)
  const isSubmitting = create.isPending || update.isPending

  const handleSubmit = (values: PermissionProfileFormValues) => {
    if (profile) {
      update.mutate(toUpdate(values), { onSuccess: onClose })
    } else {
      create.mutate(toCreate(values), { onSuccess: onClose })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={profile ? 'Editar perfil de permisos' : 'Crear perfil de permisos'}
      description="Plantilla de privilegios por motor, reutilizable al aplicar permisos a un usuario."
      size="lg"
    >
      <PermissionProfileForm
        mode={profile ? 'edit' : 'create'}
        defaultValues={
          profile
            ? {
                name: profile.name,
                engine: profile.engine,
                description: profile.description ?? '',
                is_active: profile.is_active,
                items: profile.items.map((item) => ({
                  level: item.level,
                  privileges: item.privileges,
                })),
              }
            : undefined
        }
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  )
}
