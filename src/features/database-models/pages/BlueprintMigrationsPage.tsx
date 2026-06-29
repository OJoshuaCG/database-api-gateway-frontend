import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  PageHeader,
  Pagination,
  Spinner,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import type { ModelMigrationSummary } from '@/lib/contracts'
import { useDatabaseModel } from '../hooks/use-database-models'
import { useDeleteModelMigration, useModelMigrations } from '../hooks/use-model-migrations'
import { ModelMigrationFormModal } from '../components/ModelMigrationFormModal'
import { ModelMigrationDetailPanel } from '../components/ModelMigrationDetailPanel'
import { ApplyAllDialog } from '../components/ApplyAllDialog'

/**
 * Página completa (maestro-detalle) de las versiones de un blueprint (Plan 09 §7-ter). Sustituye
 * al antiguo modal: a la izquierda el catálogo de versiones (ligero, sin SQL); a la derecha el
 * detalle de la versión seleccionada (SQL traducido, edición, aprobación de baseline).
 */
export function BlueprintMigrationsPage() {
  const params = useParams()
  const modelId = Number(params.modelId)

  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [applyAllOpen, setApplyAllOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ModelMigrationSummary | null>(null)

  const model = useDatabaseModel(modelId)
  const migrations = useModelMigrations(modelId, { page, size: 20 }, Number.isFinite(modelId))
  const deleteMigration = useDeleteModelMigration(modelId)

  // Selección por defecto: la primera versión visible si todavía no hay ninguna elegida.
  const items = migrations.data?.items ?? []
  useEffect(() => {
    const first = items[0]
    if (selected === null && first) setSelected(first.version)
  }, [items, selected])

  if (Number.isNaN(modelId)) {
    return <ErrorState error={new Error('Identificador de blueprint inválido.')} />
  }
  if (model.isLoading) return <FullPageSpinner label="Cargando blueprint" />
  if (model.isError || !model.data) {
    return <ErrorState error={model.error} onRetry={() => void model.refetch()} />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to="/database-models" className="text-sm text-muted-foreground hover:text-foreground">
          ← Blueprints
        </Link>
        <PageHeader
          title={model.data.name}
          description="Versiones (deltas SQL) del blueprint. El SQL base se escribe en estilo MySQL y se traduce a PostgreSQL automáticamente."
          actions={
            <>
              <Button variant="outline" onClick={() => setApplyAllOpen(true)}>
                Aplicar a todas 🔌
              </Button>
              <Button onClick={() => setCreateOpen(true)}>Nueva migración</Button>
            </>
          }
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge tone="info">versión actual: {model.data.current_version}</Badge>
          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {model.data.slug}
          </code>
          <Badge tone={model.data.is_active ? 'success' : 'neutral'}>
            {model.data.is_active ? 'Activo' : 'Inactivo'}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        {/* Maestro: catálogo de versiones */}
        <Card className="h-fit">
          <CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
              Versiones
            </div>
            {migrations.isLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" /> Cargando…
              </div>
            ) : migrations.isError ? (
              <div className="p-4">
                <ErrorState error={migrations.error} onRetry={() => void migrations.refetch()} />
              </div>
            ) : items.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="Sin migraciones"
                  description="Crea la primera migración (delta SQL) de este blueprint."
                />
              </div>
            ) : (
              <>
                <ul className="flex flex-col">
                  {items.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(m.version)}
                        className={cn(
                          'flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors last:border-0',
                          selected === m.version
                            ? 'bg-primary/10'
                            : 'hover:bg-surface-muted',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                            {m.version}
                          </code>
                          <span className="truncate text-sm font-medium text-foreground">
                            {m.name}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={m.has_rollback ? 'success' : 'neutral'}>
                            {m.has_rollback ? 'rollback' : 'sin rollback'}
                          </Badge>
                          {m.has_mysql_override && <Badge tone="warning">MySQL*</Badge>}
                          {m.has_postgresql_override && <Badge tone="warning">PG*</Badge>}
                          {m.is_baseline && <Badge tone="info">baseline</Badge>}
                          {m.reviewed === false && <Badge tone="warning">⚠ revisar</Badge>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                {migrations.data && migrations.data.pagination.pages > 1 && (
                  <div className="p-3">
                    <Pagination
                      page={migrations.data.pagination.page}
                      pages={migrations.data.pagination.pages}
                      total={migrations.data.pagination.total}
                      size={migrations.data.pagination.size}
                      hasNext={migrations.data.pagination.has_next}
                      hasPrev={migrations.data.pagination.has_prev}
                      onPageChange={setPage}
                    />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Detalle: SQL de la versión seleccionada */}
        <Card className="h-fit">
          <CardContent>
            <ModelMigrationDetailPanel
              modelId={modelId}
              version={selected}
              onDeleted={() => setSelected(null)}
              onRequestDelete={setDeleteTarget}
            />
          </CardContent>
        </Card>
      </div>

      <ModelMigrationFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        modelId={modelId}
      />
      <ApplyAllDialog
        modelId={modelId}
        modelName={model.data.name}
        open={applyAllOpen}
        onClose={() => setApplyAllOpen(false)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return
          const removed = deleteTarget.version
          deleteMigration.mutate(deleteTarget.version, {
            onSuccess: () => {
              setDeleteTarget(null)
              if (selected === removed) setSelected(null)
            },
          })
        }}
        title="Eliminar migración"
        description={`Se eliminará la versión ${deleteTarget?.version}. Solo posible si no tiene historial de aplicación.`}
        confirmLabel="Eliminar"
        isLoading={deleteMigration.isPending}
      />
    </div>
  )
}
