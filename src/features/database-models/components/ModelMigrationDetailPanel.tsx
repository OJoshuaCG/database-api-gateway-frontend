import { Badge, Button, EmptyState, ErrorState, Spinner } from '@/components/ui'
import type { ModelMigrationSummary } from '@/lib/contracts'
import { useModelMigration, useUpdateModelMigration } from '../hooks/use-model-migrations'
import { ModelMigrationForm, toPatch, type ModelMigrationFormValues } from './ModelMigrationForm'
import { MigrationSqlView } from './MigrationSqlView'

interface ModelMigrationDetailPanelProps {
  modelId: number
  version: string | null
  onDeleted: () => void
  onRequestDelete: (migration: ModelMigrationSummary) => void
}

/**
 * Panel de detalle (lado derecho del maestro-detalle de la página de blueprint): muestra el SQL
 * de la versión seleccionada, permite editar (name/down_sql/overrides) y aprobar un baseline de
 * snapshot pendiente de revisión (R1). El SQL base de una versión ya aplicada no se edita (`409`).
 */
export function ModelMigrationDetailPanel({
  modelId,
  version,
  onRequestDelete,
}: ModelMigrationDetailPanelProps) {
  const open = version !== null
  const { data, isLoading, isError, error, refetch } = useModelMigration(
    modelId,
    version ?? '',
    open,
  )
  const update = useUpdateModelMigration(modelId)

  if (!open) {
    return (
      <EmptyState
        title="Selecciona una versión"
        description="Elige una migración de la lista para ver su SQL y editarla."
      />
    )
  }
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando versión…
      </div>
    )
  }
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null

  const handleSubmit = (values: ModelMigrationFormValues) => {
    update.mutate({ version: data.version, body: toPatch(values) })
  }

  const approveBaseline = () => {
    update.mutate({ version: data.version, body: { reviewed: true } })
  }

  const needsReview = data.reviewed === false

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{data.version}</code>
        <span className="font-medium text-foreground">{data.name}</span>
        {data.is_baseline && <Badge tone="info">baseline</Badge>}
        {data.has_non_portable && (
          <Badge tone="warning">🔒 {data.source_engine ?? 'motor específico'}</Badge>
        )}
        {data.reviewed === false ? (
          <Badge tone="warning">⚠ pendiente de revisión</Badge>
        ) : data.reviewed === true ? (
          <Badge tone="success">revisado</Badge>
        ) : null}
      </div>

      {needsReview && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
          <p className="text-sm text-foreground">
            Este baseline se capturó del motor y nace <strong>sin revisar</strong>. No se podrá
            aplicar a ninguna BD (el backend responde <code>409</code>) hasta que lo apruebes.
          </p>
          <div className="flex justify-end">
            <Button size="sm" isLoading={update.isPending} onClick={approveBaseline}>
              Revisar y aprobar
            </Button>
          </div>
        </div>
      )}

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
        onCancel={() => void refetch()}
      />

      <details className="rounded-lg border border-border p-3" open>
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          SQL traducido por motor (referencia)
        </summary>
        <div className="mt-3">
          <MigrationSqlView migration={data} />
        </div>
      </details>

      <div className="flex justify-end border-t border-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onRequestDelete({
              id: data.id,
              model_id: data.model_id,
              version: data.version,
              name: data.name,
              has_mysql_override: Boolean(data.up_sql_mysql),
              has_postgresql_override: Boolean(data.up_sql_postgresql),
              has_rollback: Boolean(data.down_sql),
              is_baseline: data.is_baseline,
              has_non_portable: data.has_non_portable,
              reviewed: data.reviewed,
              checksum: data.checksum,
              created_at: data.created_at,
            })
          }
        >
          Eliminar esta versión
        </Button>
      </div>
    </div>
  )
}
