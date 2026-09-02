import { Modal } from '@/components/ui'
import type { ManagedDatabaseOut } from '@/lib/contracts'
import { useCreateManagedDatabase, useUpdateManagedDatabase } from '../hooks/use-managed-databases'
import {
  ManagedDatabaseForm,
  toManagedDatabaseCreate,
  toManagedDatabaseUpdate,
  type ManagedDatabaseFormValues,
} from './ManagedDatabaseForm'

interface ManagedDatabaseFormModalProps {
  open: boolean
  onClose: () => void
  database?: ManagedDatabaseOut
  defaultServerId?: number
  serverName?: string
}

export function ManagedDatabaseFormModal({
  open,
  onClose,
  database,
  defaultServerId,
  serverName,
}: ManagedDatabaseFormModalProps) {
  const create = useCreateManagedDatabase()
  const update = useUpdateManagedDatabase(database?.id ?? 0)
  const isSubmitting = create.isPending || update.isPending

  const handleSubmit = (
    values: ManagedDatabaseFormValues,
    dirtyFields: Partial<Record<keyof ManagedDatabaseFormValues, unknown>>,
  ) => {
    if (database) {
      update.mutate(toManagedDatabaseUpdate(values, dirtyFields), { onSuccess: onClose })
    } else {
      // `provision: true` fijo, sin switch: ver el comentario largo en `ManagedDatabaseForm`.
      // El flag sigue en la capa API porque el endpoint lo acepta, pero desde la SPA crear una
      // base SIEMPRE la crea en el motor.
      create.mutate(
        { body: toManagedDatabaseCreate(values), provision: true },
        { onSuccess: onClose },
      )
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={database ? 'Editar base de datos' : 'Crear base de datos'}
      description={
        database
          ? 'Actualiza la metadata de la base de datos (no toca el motor).'
          : 'Crea la base de datos en el motor 🔌 y la registra en el inventario. No otorga ' +
            'privilegios: se asignan aparte desde Permisos.'
      }
      size="lg"
    >
      <ManagedDatabaseForm
        mode={database ? 'edit' : 'create'}
        defaultValues={
          database
            ? {
                model_id: database.model_id ?? null,
                // PRECARGA OBLIGATORIA. Sin esto el campo arrancaría en el `null` de DEFAULTS y,
                // en cuanto react-hook-form lo marcara como tocado, el PATCH desclasificaría la
                // base. La otra mitad de la defensa es que el body va por `dirtyFields`.
                environment_id: database.environment_id ?? null,
                notes: database.notes ?? '',
              }
            : { server_id: defaultServerId ?? 0 }
        }
        readonlyIdentity={database ? { name: database.name, serverName } : undefined}
        readonlyCharsetCollation={
          database
            ? { charset: database.charset ?? null, collation: database.collation ?? null }
            : undefined
        }
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  )
}
