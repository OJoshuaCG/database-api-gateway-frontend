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

  const handleSubmit = (values: ManagedDatabaseFormValues) => {
    if (database) {
      update.mutate(toManagedDatabaseUpdate(values), { onSuccess: onClose })
    } else {
      create.mutate(
        { body: toManagedDatabaseCreate(values), provision: values.provision },
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
          : 'Registra una base de datos. Con aprovisionar, se ejecuta CREATE DATABASE + GRANT.'
      }
      size="lg"
    >
      <ManagedDatabaseForm
        mode={database ? 'edit' : 'create'}
        defaultValues={
          database
            ? {
                model_id: database.model_id ?? null,
                model_version: database.model_version ?? '',
                charset: database.charset ?? '',
                collation: database.collation ?? '',
                notes: database.notes ?? '',
              }
            : { server_id: defaultServerId ?? 0 }
        }
        readonlyIdentity={database ? { name: database.name, serverName } : undefined}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  )
}
