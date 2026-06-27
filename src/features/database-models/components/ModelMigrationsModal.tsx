import { useState } from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  Pagination,
  Spinner,
} from '@/components/ui'
import type { DatabaseModelOut, ModelMigrationSummary } from '@/lib/contracts'
import { useDeleteModelMigration, useModelMigrations } from '../hooks/use-model-migrations'
import { ModelMigrationFormModal } from './ModelMigrationFormModal'
import { ModelMigrationDetailModal } from './ModelMigrationDetailModal'
import { ApplyAllDialog } from './ApplyAllDialog'

interface ModelMigrationsModalProps {
  model: DatabaseModelOut | null
  onClose: () => void
}

/** Migraciones de un blueprint (§8): secuencia versionada de deltas SQL. */
export function ModelMigrationsModal({ model, onClose }: ModelMigrationsModalProps) {
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [applyAllOpen, setApplyAllOpen] = useState(false)
  const [detailVersion, setDetailVersion] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ModelMigrationSummary | null>(null)

  const modelId = model?.id ?? 0
  const { data, isLoading, isError, error, refetch } = useModelMigrations(
    modelId,
    { page, size: 10 },
    model !== null,
  )
  const deleteMigration = useDeleteModelMigration(modelId)

  return (
    <Modal
      open={model !== null}
      onClose={onClose}
      title="Migraciones del blueprint"
      description={model ? `«${model.name}» · versión actual ${model.current_version}` : undefined}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setApplyAllOpen(true)}>
            Aplicar a todas 🔌
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Nueva migración
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando…
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Sin migraciones"
            description="Crea la primera migración (delta SQL) de este blueprint."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Versión</th>
                    <th className="px-3 py-2 font-semibold">Nombre</th>
                    <th className="px-3 py-2 font-semibold">Marcas</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((migration) => (
                    <tr key={migration.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                          {migration.version}
                        </code>
                      </td>
                      <td className="px-3 py-2 text-foreground">{migration.name}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={migration.has_rollback ? 'success' : 'neutral'}>
                            {migration.has_rollback ? 'rollback' : 'sin rollback'}
                          </Badge>
                          {migration.has_mysql_override && <Badge tone="warning">MySQL*</Badge>}
                          {migration.has_postgresql_override && <Badge tone="warning">PG*</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDetailVersion(migration.version)}
                          >
                            Detalle
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(migration)}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && data.pagination.pages > 1 && (
              <Pagination
                page={data.pagination.page}
                pages={data.pagination.pages}
                total={data.pagination.total}
                size={data.pagination.size}
                hasNext={data.pagination.has_next}
                hasPrev={data.pagination.has_prev}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </div>

      <ModelMigrationFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        modelId={modelId}
      />
      <ModelMigrationDetailModal
        modelId={modelId}
        version={detailVersion}
        onClose={() => setDetailVersion(null)}
      />
      <ApplyAllDialog
        modelId={modelId}
        modelName={model?.name}
        open={applyAllOpen}
        onClose={() => setApplyAllOpen(false)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return
          deleteMigration.mutate(deleteTarget.version, { onSuccess: () => setDeleteTarget(null) })
        }}
        title="Eliminar migración"
        description={`Se eliminará la versión ${deleteTarget?.version}. Solo posible si no tiene historial de aplicación.`}
        confirmLabel="Eliminar"
        isLoading={deleteMigration.isPending}
      />
    </Modal>
  )
}
