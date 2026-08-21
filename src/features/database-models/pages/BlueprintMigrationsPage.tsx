import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
  TabButton,
} from '@/components/ui'
import { PAGINATION, type ModelDatabaseStatus } from '@/lib/contracts'
import { toApiError } from '@/lib/api/errors'
import { useDatabaseModel } from '../hooks/use-database-models'
import { useDeleteModelMigration, useModelMigrations } from '../hooks/use-model-migrations'
import { ModelMigrationDetailPanel } from '../components/ModelMigrationDetailPanel'
import { ApplyMigrationsDialog } from '../components/ApplyMigrationsDialog'
import { ModelDatabasesStatusTable } from '../components/ModelDatabasesStatusTable'
import { VersionsTable } from '../components/VersionsTable'
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

  // La pestaña vive en la URL, no en `useState`: así se puede enlazar y compartir «el estado
  // de este blueprint», y volver atrás no pierde dónde estabas. Mismo patrón que
  // `ManagedDatabaseMigrationsContent`, que ya guarda `?tab=` y `?reconcile=`.
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'estado' ? 'estado' : 'versiones'
  const setTab = (next: 'versiones' | 'estado') =>
    setSearchParams((params) => {
      if (next === 'versiones') params.delete('tab')
      else params.set('tab', next)
      return params
    })

  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [applyAllOpen, setApplyAllOpen] = useState(false)
  const [applyTargets, setApplyTargets] = useState<ModelDatabaseStatus[]>([])
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
          ← Blueprint schemas
        </Link>
        <PageHeader
          title={model.data.name}
          description="Versiones (deltas SQL) del blueprint. El SQL base se escribe en estilo MySQL y se traduce a PostgreSQL automáticamente."
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setApplyTargets([])
                  setApplyAllOpen(true)
                }}
              >
                Aplicar… 🔌
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

      <div role="tablist" className="flex items-center gap-1 border-b border-border">
        <TabButton active={tab === 'versiones'} onClick={() => setTab('versiones')}>
          Versiones
        </TabButton>
        <TabButton active={tab === 'estado'} onClick={() => setTab('estado')}>
          Estado en las BDs
        </TabButton>
      </div>

      {tab === 'estado' ? (
        <ModelDatabasesStatusTable
          modelId={modelId}
          onApplyTo={(database) => {
            setApplyTargets([database])
            setApplyAllOpen(true)
          }}
        />
      ) : (
        <>
          {/* Selector de versión: sticky, para no perder de vista cuál se está mirando al
              bajar por el detalle (que es largo). La tabla de abajo sirve para ESCANEAR las
              versiones y comparar sus insignias; el navegador, para moverse entre ellas. */}
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

          {sorted.length > 0 && (
            <VersionsTable
              versions={sorted}
              isLoading={migrations.isLoading}
              selectedVersion={selected?.version ?? null}
              onSelect={setSelectedVersion}
            />
          )}

          {sorted.length > 0 && (
            <ModelMigrationDetailPanel
              modelId={modelId}
              version={selected?.version ?? null}
              latestVersion={latestVersion}
              blueprintCollation={model.data.collation}
              onRequestDelete={setDeleteTarget}
              onCreateNewVersion={() => void navigate(newVersionPath)}
            />
          )}
        </>
      )}

      <ApplyMigrationsDialog
        // `key` con los destinos: el diálogo nace con la preselección correcta al abrirlo
        // desde una fila, sin un efecto que sincronice props con estado interno.
        key={applyTargets.map((t) => t.id).join(',') || 'all'}
        modelId={modelId}
        modelName={model.data.name}
        open={applyAllOpen}
        initialTargets={applyTargets}
        onClose={() => setApplyAllOpen(false)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null)
          setDeleteError(null)
        }}
        onConfirm={() => {
          if (!deleteTarget) return
          setDeleteError(null)
          deleteMigration.mutate(deleteTarget, {
            onSuccess: () => setDeleteTarget(null),
            onError: (err) => {
              // El 409 se muestra AQUÍ, no solo como toast: su mensaje es la única forma de
              // saber cuál de las tres reglas se incumplió (aplicada con éxito / aplicación
              // parcial sin resolver / dejó de ser la punta), y cada una lleva a una acción
              // distinta. Cerrar el diálogo dejaba al operador con un toast que se va solo.
              const apiError = toApiError(err)
              if (apiError.status === 409) {
                setDeleteError(apiError.message)
                void migrations.refetch()
              }
            },
          })
        }}
        title="Eliminar la última versión"
        description={`Se eliminará la versión ${deleteTarget} del blueprint. Es irreversible, y solo es posible en la última versión y mientras ninguna BD la haya aplicado con éxito.`}
        confirmLabel="Eliminar"
        isLoading={deleteMigration.isPending}
      >
        <div className="flex flex-col gap-2">
          {/* Un intento fallido no impide borrar, pero su rastro sí se va: al eliminar la
              versión se pierden sus filas de historial (queda constancia en la auditoría). */}
          <p className="text-sm text-muted-foreground">
            Si esta versión llegó a intentarse y falló, se descartará también el registro de esos
            intentos por BD.
          </p>
          {deleteError && (
            <p className="rounded-lg border border-error/40 bg-error/5 p-3 text-sm text-error">
              {deleteError}
            </p>
          )}
        </div>
      </ConfirmDialog>
    </div>
  )
}
