import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
  Spinner,
} from '@/components/ui'
import { PAGINATION, type ModelMigrationSummary } from '@/lib/contracts'
import { toApiError } from '@/lib/api/errors'
import { useDatabaseModel } from '../hooks/use-database-models'
import { useDeleteModelMigration, useModelMigrations } from '../hooks/use-model-migrations'
import { ModelMigrationDetailPanel } from '../components/ModelMigrationDetailPanel'
import { ApplyAllDialog } from '../components/ApplyAllDialog'
import { VersionNavigator } from '../components/VersionNavigator'
import { latestVersionOf, resolveVersionIndex, sortVersionsAscending } from '../version-nav'

/**
 * Página de versiones de un blueprint (Plan 09 §7-ter), a todo el ancho: arriba un desplegable con
 * las versiones; al elegir una, un card delgado con su estado y, debajo, un card con el SQL y la
 * edición. Sustituye al antiguo modal y al layout maestro-detalle de dos columnas.
 */
export function BlueprintMigrationsPage() {
  const params = useParams()
  const modelId = Number(params.modelId)
  const navigate = useNavigate()
  const newVersionPath = `/database-models/${modelId}/migrations/new`

  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
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

  // El backend no garantiza el orden de la lista y las versiones se ordenan NUMÉRICAMENTE (§8),
  // así que se ordena en cliente antes de navegarla. La dependencia es `migrations.data`, que sí
  // es estable entre renders: un `?? []` intermedio crearía un array nuevo cada vez y el memo no
  // llegaría a servir de nada.
  const sorted = useMemo(
    () => sortVersionsAscending(migrations.data?.items ?? []),
    [migrations.data],
  )
  const total = migrations.data?.pagination.total ?? sorted.length

  // Selección efectiva derivada (sin estado redundante, sin efecto de sincronización): la versión
  // elegida si sigue existiendo, o por defecto la MÁS RECIENTE — que es el estado actual del
  // blueprint y lo que el admin espera ver al entrar.
  const index = resolveVersionIndex(sorted, selectedVersion)
  const selected = sorted[index] ?? null

  // Versión punta: solo ella se puede eliminar (Cambio 3); el backend recalcula
  // `current_version` al borrarla.
  const latestVersion = latestVersionOf(sorted)

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
              <Button onClick={() => void navigate(newVersionPath)}>Nueva versión</Button>
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

      {/* Selector de versión: sticky, para no perder de vista cuál se está mirando al bajar
          por el detalle (que es largo: formulario de SQL más los bloques traducidos). */}
      {sorted.length > 0 ? (
        <VersionNavigator
          sorted={sorted}
          index={index}
          onSelect={setSelectedVersion}
          total={total}
        />
      ) : (
        <Card>
          <CardContent className="py-4">
            {migrations.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" /> Cargando versiones…
              </div>
            ) : migrations.isError ? (
              <ErrorState error={migrations.error} onRetry={() => void migrations.refetch()} />
            ) : (
              <EmptyState
                title="Sin migraciones"
                description="Crea la primera migración (delta SQL) de este blueprint."
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Estado + detalle de la versión seleccionada */}
      {sorted.length > 0 && (
        <ModelMigrationDetailPanel
          modelId={modelId}
          version={selected?.version ?? null}
          latestVersion={latestVersion}
          onRequestDelete={setDeleteTarget}
          onCreateNewVersion={() => void navigate(newVersionPath)}
        />
      )}

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
            onError: (err) => {
              // Solo el 409 (dejó de ser la punta o ganó historial) invalida la premisa: cerramos y
              // refrescamos para recalcular la punta. En otros errores (red/500) mantenemos el
              // diálogo abierto para reintentar (el hook ya muestra el detail.msg en un toast).
              if (toApiError(err).status === 409) {
                setDeleteTarget(null)
                void migrations.refetch()
              }
            },
          })
        }}
        title="Eliminar la última versión"
        description={`Se eliminará la versión ${deleteTarget?.version} del blueprint. Esta acción es irreversible y solo es posible en la última versión sin historial de aplicación.`}
        confirmLabel="Eliminar"
        isLoading={deleteMigration.isPending}
      />
    </div>
  )
}
