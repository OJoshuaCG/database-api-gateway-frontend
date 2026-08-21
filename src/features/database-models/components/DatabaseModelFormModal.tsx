import { Modal } from '@/components/ui'
import type { DatabaseModelOut } from '@/lib/contracts'
import { useCreateDatabaseModel, useUpdateDatabaseModel } from '../hooks/use-database-models'
import {
  DatabaseModelForm,
  toDatabaseModelCreate,
  toDatabaseModelUpdate,
  type DatabaseModelFormValues,
} from './DatabaseModelForm'

interface DatabaseModelFormModalProps {
  open: boolean
  onClose: () => void
  model?: DatabaseModelOut
}

export function DatabaseModelFormModal({ open, onClose, model }: DatabaseModelFormModalProps) {
  const create = useCreateDatabaseModel()
  const update = useUpdateDatabaseModel(model?.id ?? 0)
  const isSubmitting = create.isPending || update.isPending

  const handleSubmit = (values: DatabaseModelFormValues) => {
    if (model) {
      update.mutate(toDatabaseModelUpdate(values), { onSuccess: onClose })
    } else {
      create.mutate(toDatabaseModelCreate(values), { onSuccess: onClose })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={model ? 'Editar blueprint' : 'Crear blueprint'}
      description="Categoría lógica reutilizable de bases de datos. No toca ningún motor."
      size="lg"
    >
      <DatabaseModelForm
        mode={model ? 'edit' : 'create'}
        defaultValues={
          model
            ? {
                name: model.name,
                slug: model.slug,
                description: model.description ?? '',
                current_version: model.current_version,
                is_active: model.is_active,
                // `null` cuando el blueprint no lo declara: el selector se queda en "por
                // defecto del motor" en vez de autopreseleccionar y declararlo sin querer.
                charsetCollation: model.charset
                  ? { charset: model.charset, collation: model.collation ?? null }
                  : null,
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
