import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CardContent,
  Combobox,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  PageHeader,
  Spinner,
} from '@/components/ui'
import { PAGINATION, type ModelMigrationSummary } from '@/lib/contracts'
import { useDatabaseModel } from '../hooks/use-database-models'
import { useDeleteModelMigration, useModelMigrations } from '../hooks/use-model-migrations'
import { ModelMigrationFormModal } from '../components/ModelMigrationFormModal'
import { ModelMigrationDetailPanel } from '../components/ModelMigrationDetailPanel'
import { ApplyAllDialog } from '../components/ApplyAllDialog'

/**
 * Página de versiones de un blueprint (Plan 09 §7-ter), a todo el ancho: arriba un desplegable con
 * las versiones; al elegir una, un card delgado con su estado y, debajo, un card con el SQL y la
 * edición. Sustituye al antiguo modal y al layout maestro-detalle de dos columnas.
 */
export function BlueprintMigrationsPage() {
  const params = useParams()
  const modelId = Number(params.modelId)

  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [applyAllOpen, setApplyAllOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ModelMigrationSummary | null>(null)

  const model = useDatabaseModel(modelId)
  // El desplegable necesita el catálogo completo (ligero, sin SQL): pedimos el máximo por página.
  const migrations = useModelMigrations(
    modelId,
    { page: 1, size: PAGINATION.maxSize },
    Number.isFinite(modelId),
  )

  const deleteMigration = useDeleteModelMigration(modelId)

  const items = migrations.data?.items ?? []
  const total = migrations.data?.pagination.total ?? items.length

  // Selección efectiva derivada (sin estado redundante): la versión elegida si sigue existiendo,
  // o por defecto la primera. Así no hace falta sincronizar con un efecto.
  const selected = items.find((m) => m.version === selectedVersion) ?? items[0] ?? null

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

      {/* Selector de versión (desplegable, ancho completo) */}
      <Card>
        <CardContent className="py-4">
          {migrations.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Cargando versiones…
            </div>
          ) : migrations.isError ? (
            <ErrorState error={migrations.error} onRetry={() => void migrations.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              title="Sin migraciones"
              description="Crea la primera migración (delta SQL) de este blueprint."
            />
          ) : (
            <div className="flex flex-col gap-2">
              <Combobox<ModelMigrationSummary>
                items={items}
                value={selected}
                onChange={(m) => setSelectedVersion(m?.version ?? null)}
                itemToString={(m) => `${m.version} · ${m.name}`}
                itemToKey={(m) => m.id}
                label="Versión"
                placeholder="Selecciona una versión…"
                renderItem={(m) => (
                  <div className="flex w-full items-center gap-2">
                    <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                      {m.version}
                    </code>
                    <span className="truncate text-foreground">{m.name}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {m.is_baseline && <Badge tone="info">baseline</Badge>}
                      {m.reviewed === false && <Badge tone="warning">⚠</Badge>}
                      {m.has_rollback && <Badge tone="success">↩</Badge>}
                    </span>
                  </div>
                )}
              />
              <p className="text-xs text-muted-foreground">
                {total} versión(es){total > items.length ? ` · mostrando ${items.length}` : ''}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Estado + detalle de la versión seleccionada */}
      {items.length > 0 && (
        <ModelMigrationDetailPanel
          modelId={modelId}
          version={selected?.version ?? null}
          onRequestDelete={setDeleteTarget}
        />
      )}

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
          deleteMigration.mutate(deleteTarget.version, {
            onSuccess: () => setDeleteTarget(null),
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
