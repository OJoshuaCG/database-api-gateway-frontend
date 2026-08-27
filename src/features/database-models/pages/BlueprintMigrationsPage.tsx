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
import { BlueprintProjectsSection } from '@/features/projects'
import { PAGINATION, type ModelDatabaseStatus } from '@/lib/contracts'
import { toApiError } from '@/lib/api/errors'
import { useDatabaseModel } from '../hooks/use-database-models'
import { useDeleteModelMigration, useModelMigrations } from '../hooks/use-model-migrations'
import { ModelMigrationDetailPanel } from '../components/ModelMigrationDetailPanel'
import { ApplyMigrationsDialog } from '../components/ApplyMigrationsDialog'
import { ModelDatabasesStatusTable } from '../components/ModelDatabasesStatusTable'
import { VersionNavigator } from '../components/VersionNavigator'
import { VersionAlertsBar } from '../components/VersionAlertsBar'
import { VersionFactsCard } from '../components/VersionFactsCard'
import { latestVersionOf, resolveVersionIndex, sortVersionsAscending } from '../version-nav'
import { versionAlerts } from '../version-alerts'

/**
 * Página de versiones de un blueprint (Plan 09 §7-ter), a todo el ancho.
 *
 * Cuatro piezas apiladas, en este orden: la barra de avisos del catálogo, el desplegable de versión
 * (sticky), la **ficha de la versión seleccionada** y el card con su SQL y la edición.
 *
 * **Ya no hay tabla de versiones.** Existió para escanear el catálogo, pero acabó siendo el tercer
 * sitio donde se pintaban las mismas insignias —con tres vocabularios que divergieron— y empujaba
 * el detalle fuera de la primera pantalla. Lo que aportaba se reparte: el escaneo va a
 * `VersionAlertsBar` (qué versiones están sin revisar, sin rollback, con el SQL editado o
 * congelado, con su lista y su consecuencia) y el estado de UNA versión va a `VersionFactsCard`,
 * que además absorbió el antiguo «card delgado» del panel de detalle.
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
  //
  // `null` si el catálogo vino RECORTADO por el tope de página: entonces la punta real puede no
  // estar entre las cargadas, y una pista que nombre la versión equivocada al lado del botón de
  // borrar es peor que no dar pista. El navegador avisa del recorte.
  const latestVersion = total > sorted.length ? null : latestVersionOf(sorted)

  // Avisos del catálogo: lógica pura sobre `sorted`, que ya está en memoria. Mismo criterio de
  // dependencia que el memo de arriba — la dep es el array ordenado, no un `?? []` intermedio.
  const alerts = useMemo(() => versionAlerts(sorted), [sorted])

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

      {/* A qué proyectos pertenece este blueprint (api-reference-v16 §3.9). Va con la cabecera y
          fuera de las pestañas porque describe al blueprint en sí, no a sus versiones ni a su
          estado en las BDs. Su carga no bloquea nada: si falla, el resto de la pantalla sigue. */}
      <BlueprintProjectsSection modelId={modelId} />

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
          blueprintCollation={model.data.collation}
          onApplyTo={(database) => {
            setApplyTargets([database])
            setApplyAllOpen(true)
          }}
        />
      ) : (
        <>
          {/* Avisos del catálogo ANTES del selector: dicen si hay algo que resolver en el
              blueprint —versiones sin revisar que el apply va a rechazar, versiones sin rollback que
              romperían una reversión— y eso se decide antes de elegir una versión concreta. Es lo
              que repone el escaneo que daba la tabla eliminada. Si no hay avisos, no se pinta. */}
          {sorted.length > 0 && (
            <VersionAlertsBar
              alerts={alerts}
              selectedVersion={selected?.version ?? null}
              onSelect={setSelectedVersion}
            />
          )}

          {/* Selector de versión: sticky, para no perder de vista cuál se está mirando al bajar por
              el detalle (que es largo). Sirve para MOVERSE entre versiones; para escanearlas está la
              barra de avisos de arriba, porque las insignias del desplegable solo existen mientras
              el menú está abierto y el menú se cierra al elegir. */}
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

          {/* Ficha de la versión seleccionada: el ÚNICO lugar donde vive su estado. Recibe el
              resumen que ya está en memoria, así que se pinta al instante al cambiar de versión y
              solo dos de sus datos esperan al detalle. */}
          {selected && (
            <VersionFactsCard
              modelId={modelId}
              summary={selected}
              blueprintCurrentVersion={model.data.current_version}
              blueprintCollation={model.data.collation}
              latestVersion={latestVersion}
              onRequestDelete={setDeleteTarget}
            />
          )}

          {sorted.length > 0 && (
            <ModelMigrationDetailPanel
              modelId={modelId}
              version={selected?.version ?? null}
              blueprintCollation={model.data.collation}
              onCreateNewVersion={() => void navigate(newVersionPath)}
            />
          )}
        </>
      )}

      <ApplyMigrationsDialog
        // `key` con los destinos Y con el estado de apertura. Lo primero ya estaba: el diálogo
        // nace con la preselección correcta al abrirlo desde una fila, sin un efecto que
        // sincronice props con estado interno.
        //
        // Lo segundo es un arreglo: el diálogo es el PADRE del `Modal`, así que cerrarlo no lo
        // desmonta y su estado sobrevive. Abriendo siempre por "Aplicar a todas" la key era
        // constante (`'all'`), de modo que elegir un entorno, cerrar y reabrir dejaba el lote
        // filtrado sin que nada lo dijera — y lo mismo pasaba con "Forzar" y con el
        // consentimiento de captura, que el propio diálogo documenta como POR CORRIDA. Remontar
        // en cada apertura da la operación "reset" que no existía, sin escribir código nuevo.
        key={`${applyTargets.map((t) => t.id).join(',') || 'all'}-${String(applyAllOpen)}`}
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
            onSuccess: () => {
              setDeleteTarget(null)
              // También el error: si no, tras un 409 y un reintento con éxito, el mensaje
              // viejo reaparecía al abrir el diálogo para otra versión.
              setDeleteError(null)
            },
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
        // El botón vivía al pie del card de SQL: había que bajar por todo el delta para llegar, y
        // ESE scroll era la fricción. Al subirlo a la ficha —donde se decide, junto al estado de la
        // versión— hay que reponerla acá, con el mismo molde `confirm_target_name` que el resto de
        // la app usa para lo irreversible. Sin esto, borrar pasaría a ser dos clics seguidos a dos
        // dedos del selector que cambia de versión.
        confirmWord={deleteTarget ?? undefined}
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
