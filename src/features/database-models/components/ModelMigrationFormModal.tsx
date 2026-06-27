import { useState } from 'react'
import { Button, Modal } from '@/components/ui'
import type { ModelMigrationOut } from '@/lib/contracts'
import { useCreateModelMigration, useUpdateModelMigration } from '../hooks/use-model-migrations'
import { ModelMigrationForm, toCreate, type ModelMigrationFormValues } from './ModelMigrationForm'
import { MigrationSqlView } from './MigrationSqlView'

interface ModelMigrationFormModalProps {
  open: boolean
  onClose: () => void
  modelId: number
}

/** Crea una migración y, tras crearla, muestra la traducción y el rollback sugerido (§8). */
export function ModelMigrationFormModal({ open, onClose, modelId }: ModelMigrationFormModalProps) {
  const create = useCreateModelMigration(modelId)
  const update = useUpdateModelMigration(modelId)
  const [created, setCreated] = useState<ModelMigrationOut | null>(null)

  const handleSubmit = (values: ModelMigrationFormValues) => {
    create.mutate(toCreate(values), { onSuccess: (migration) => setCreated(migration) })
  }

  const handleClose = () => {
    setCreated(null)
    onClose()
  }

  const canConfirmSuggested = created && !created.down_sql && created.down_sql_suggested

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={created ? `Migración ${created.version} creada` : 'Nueva migración'}
      description={
        created
          ? 'Revisa la traducción cross-engine y confirma el rollback antes de aplicarla.'
          : 'Define un delta SQL versionado para el blueprint. No toca ningún motor.'
      }
      size="lg"
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <MigrationSqlView migration={created} />
          <div className="flex justify-end gap-2">
            {canConfirmSuggested && (
              <Button
                variant="outline"
                isLoading={update.isPending}
                onClick={() =>
                  update.mutate(
                    { version: created.version, body: { down_sql: created.down_sql_suggested } },
                    { onSuccess: (migration) => setCreated(migration) },
                  )
                }
              >
                Confirmar rollback sugerido
              </Button>
            )}
            <Button onClick={handleClose}>Listo</Button>
          </div>
        </div>
      ) : (
        <ModelMigrationForm
          mode="create"
          isSubmitting={create.isPending}
          onSubmit={handleSubmit}
          onCancel={handleClose}
        />
      )}
    </Modal>
  )
}
