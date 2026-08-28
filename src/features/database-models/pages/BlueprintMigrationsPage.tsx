import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  PageHeader,
  Spinner,
  TabButton,
} from '@/components/ui'
import { BlueprintProjectsSection } from '@/features/projects'
import {
  MIGRATION_ERROR_CODES,
  PAGINATION,
  type MigrationDeletePlanOut,
  type ModelDatabaseStatus,
} from '@/lib/contracts'
import { toApiError, type ApiError } from '@/lib/api/errors'
import { useDatabaseModel } from '../hooks/use-database-models'
import { useModelMigrationDeletePlan, useModelMigrations } from '../hooks/use-model-migrations'
import { ModelMigrationDetailPanel } from '../components/ModelMigrationDetailPanel'
import { ApplyMigrationsDialog } from '../components/ApplyMigrationsDialog'
import { MigrationDeletePlanDialog } from '../components/MigrationDeletePlanDialog'
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
  /**
   * Plan de borrado ya comprobado, con la versión a la que pertenece. Es lo que abre el diálogo:
   * mientras es `null` no hay diálogo, y no existe un estado intermedio de «diálogo abierto sin
   * plan». Así el diálogo nunca tiene que pedir nada al montar.
   */
  const [deletePlanned, setDeletePlanned] = useState<{
    version: string
    plan: MigrationDeletePlanOut
  } | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const model = useDatabaseModel(modelId)
  // El desplegable necesita el catálogo completo (ligero, sin SQL): pedimos el máximo por página.
  const migrations = useModelMigrations(
    modelId,
    { page: 1, size: PAGINATION.maxSize },
    Number.isFinite(modelId),
  )

  const deletePlan = useModelMigrationDeletePlan(modelId)

  /**
   * Pedir el plan de borrado ANTES de abrir nada (api-reference-v18 §2).
   *
   * El `delete-plan` es un GET que no modifica nada, pero abre conexión a cada BD del blueprint:
   * es la única lectura autoritativa de si esta versión se puede borrar y de a qué bases habría
   * que escribirles. Se lanza desde el clic y no desde el montaje del diálogo, que es el mismo
   * criterio que ya sigue `MigrationEditOverrideDialog` con su `initialPreview`.
   *
   * Si falla, el diálogo **no se abre**: sin plan no hay nada que confirmar, y un diálogo vacío
   * con un error dentro invita a reintentar el borrado a ciegas.
   */
  const requestDelete = (version: string) => {
    setDeleteError(null)
    deletePlan.mutate(version, {
      onSuccess: (plan) => setDeletePlanned({ version, plan }),
      onError: (err) => {
        const apiError = toApiError(err)
        // Se clasifica por `public_context.code`, nunca leyendo el `message`: el backend no
        // transcribe el error del motor a propósito (puede llevar host, usuario o fragmentos de
        // sentencia). El 409 se refleja además en el listado, porque `deletable` de la caché
        // acaba de quedar desmentido por la lectura en vivo.
        if (apiError.status === 409) void migrations.refetch()
        setDeleteError(deletePlanErrorText(apiError))
      },
    })
  }

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

  // Versión punta. **Ya no es «la única que se puede eliminar»**: desde api-reference-v18 el
  // backend deja borrar cualquier versión, punta o intermedia —renumera las posteriores y mueve
  // el puntero de las BDs que estén más adelante—, así que ser la punta dejó de ser un requisito.
  //
  // Sigue haciendo falta para UNA cosa: redactar la pista del `block_reason` legado `not_tip`,
  // que solo devuelve un gateway anterior a v18.
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
              onRequestDelete={requestDelete}
            />
          )}

          {/* La comprobación abre conexión a CADA BD del blueprint, así que puede tardar. Sin
              este aviso el clic en «Eliminar…» no produce ningún cambio visible durante segundos
              y el operador vuelve a pulsar, lanzando una segunda lectura del parque entero. */}
          {deletePlan.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Comprobando el plan de borrado contra las bases de
              datos…
            </div>
          )}

          {/* El fallo de la COMPROBACIÓN vive aquí, en línea y junto a la ficha desde donde se
              pidió: el diálogo no llega a abrirse, así que no hay dónde meterlo dentro. Se
              conserva hasta el siguiente intento —no se va solo como un toast— porque cada
              motivo lleva a una acción distinta y hay que poder leerlo mientras se hace. */}
          {deleteError && (
            <Callout
              tone="danger"
              title="No se pudo comprobar el borrado"
              action={
                <Button size="sm" variant="ghost" onClick={() => setDeleteError(null)}>
                  Entendido
                </Button>
              }
            >
              <p>{deleteError}</p>
            </Callout>
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

      {/* Diálogo del borrado, montado SOLO cuando ya hay un plan comprobado. Recibe el plan por
          props y no lo pide al montar: la llamada nace del clic en «Eliminar…», que es donde el
          operador la pidió. La `key` con la versión lo remonta al cambiar de objetivo, así que no
          arrastra ni el reconocimiento ni la reescritura de la versión anterior. */}
      {deletePlanned && (
        <MigrationDeletePlanDialog
          key={deletePlanned.version}
          modelId={modelId}
          version={deletePlanned.version}
          initialPlan={deletePlanned.plan}
          onClose={() => setDeletePlanned(null)}
          onDeleted={() => {
            setDeletePlanned(null)
            // La selección vuelve a la derivada por defecto (la más reciente). No se puede
            // conservar: tras un borrado con renumerado, el número que estaba elegido puede
            // designar ahora OTRA migración, y quedarse en él mostraría un delta distinto bajo el
            // mismo rótulo.
            setSelectedVersion(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Texto del fallo del `GET .../delete-plan`, clasificado por `public_context.code`.
 *
 * **Nunca se parsea el `message` del backend para decidir la rama**: no transcribe el error del
 * motor a propósito (puede llevar host, usuario o fragmentos de sentencia), así que su prosa no es
 * un dato estable. Se clasifica por código y se cae al `message` solo como último recurso, que es
 * cuando ya no hay nada mejor que decir.
 *
 * La comprobación abre conexión a cada BD del blueprint, así que puede devolver 409 aunque sea un
 * GET: eso significa que la caché del inventario —de donde salió el `deletable` que habilitó el
 * botón— acaba de quedar desmentida por la lectura en vivo. Manda el plan, siempre.
 */
function deletePlanErrorText(apiError: ApiError): string {
  switch (apiError.code) {
    case MIGRATION_ERROR_CODES.versionInUse:
      return 'Alguna base de datos está exactamente en esta versión, así que borrarla dejaría su puntero apuntando a algo que no existe. Muévela con un apply o un rollback y vuelve a intentarlo.'
    case MIGRATION_ERROR_CODES.unreadableDatabases:
      return 'No se pudo leer la versión de alguna base de datos, y el gateway prefiere negarse a suponer dónde está. Es un problema de acceso a esa base —motor caído, base sin aprovisionar o credenciales rotas—, no del blueprint. Arregla la conexión y vuelve a intentarlo.'
    case MIGRATION_ERROR_CODES.affectedPartialApplication:
      return 'Hay una base con una aplicación a medio camino que este borrado afectaría. Reconcilia esa aplicación parcial o termina el apply antes de eliminar la versión.'
    case MIGRATION_ERROR_CODES.renumberTargetMissing:
      return 'Al renumerar, alguna base quedaría apuntando a una versión que no figura en su historial. Revisa el historial de esas bases —lo habitual es que les falte aplicar migraciones— antes de volver a intentarlo.'
    default:
      return apiError.message
  }
}
