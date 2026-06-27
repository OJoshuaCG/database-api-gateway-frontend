import { ErrorState, Modal, Spinner } from '@/components/ui'
import { useModelMigration, useUpdateModelMigration } from '../hooks/use-model-migrations'
import { ModelMigrationForm, toPatch, type ModelMigrationFormValues } from './ModelMigrationForm'
import { MigrationSqlView } from './MigrationSqlView'

interface ModelMigrationDetailModalProps {
  modelId: number
  version: string | null
  onClose: () => void
}

/** Detalle + edición (confirmar rollback / overrides) de una migración de blueprint (§8). */
export function ModelMigrationDetailModal({
  modelId,
  version,
  onClose,
}: ModelMigrationDetailModalProps) {
  const open = version !== null
  const { data, isLoading, isError, error, refetch } = useModelMigration(
    modelId,
    version ?? '',
    open,
  )
  const update = useUpdateModelMigration(modelId)

  const handleSubmit = (values: ModelMigrationFormValues) => {
    if (!version) return
    update.mutate({ version, body: toPatch(values) }, { onSuccess: onClose })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Migración ${version ?? ''}`}
      description="No se puede modificar el SQL base de una migración ya aplicada en alguna BD."
      size="lg"
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Cargando…
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <ModelMigrationForm
            mode="edit"
            defaultValues={{
              version: data.version,
              name: data.name,
              up_sql: data.up_sql,
              up_sql_mysql: data.up_sql_mysql ?? '',
              up_sql_postgresql: data.up_sql_postgresql ?? '',
              down_sql: data.down_sql ?? data.down_sql_suggested ?? '',
            }}
            isSubmitting={update.isPending}
            onSubmit={handleSubmit}
            onCancel={onClose}
          />
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              SQL traducido (referencia)
            </summary>
            <div className="mt-3">
              <MigrationSqlView migration={data} />
            </div>
          </details>
        </div>
      ) : null}
    </Modal>
  )
}
