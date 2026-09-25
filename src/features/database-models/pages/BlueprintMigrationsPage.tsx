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
import {
  useAllModelMigrations,
  useModelMigrationDeletePlan,
  useModelMigrations,
} from '../hooks/use-model-migrations'
import { ModelMigrationDetailPanel } from '../components/ModelMigrationDetailPanel'
import { ApplyMigrationsDialog } from '../components/ApplyMigrationsDialog'
import { MigrationDeletePlanDialog } from '../components/MigrationDeletePlanDialog'
import { ModelDatabasesStatusTable } from '../components/ModelDatabasesStatusTable'
import { VersionTablesReportPanel } from '../components/VersionTablesReportPanel'
import { VersionNavigator } from '../components/VersionNavigator'
import { VersionAlertsBar } from '../components/VersionAlertsBar'
import { VersionFactsCard } from '../components/VersionFactsCard'
import { MigrationSearchPanel } from '../components/MigrationSearchPanel'
import { flipPage, resolveVersionIndex, sortVersionsAscending } from '../version-nav'
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
 *
 * **Dos lecturas del catálogo, y no es un descuido.** El navegador pide UNA página (`order=desc`,
 * la punta primero) porque recorre; la barra de avisos pide el catálogo ENTERO porque escanea, y
 * un «3 sin revisar» que en realidad son nueve es peor que no tenerlo. Van a endpoints de solo
 * metadatos, sin conexión a ningún motor. Unificarlas en la lectura completa devolvería al
 * desplegable el historial entero —que es lo que se acaba de quitar—; unificarlas en la página
 * dejaría los avisos afirmando de más.
 */
/**
 * Pestañas de la pantalla. El default (`versiones`) NO se escribe en la URL: se borra el
 * parámetro, para que la dirección compartida más corta sea la de la vista por defecto. Los otros
 * dos sí, porque `?tab=estado` ya se genera como deep-link desde `MigrationDeletePlanDialog`.
 * `buscar` sigue la misma regla: se escribe, para que una búsqueda se pueda enlazar a la pestaña.
 */
type BlueprintTab = 'versiones' | 'estado' | 'contabilidad' | 'buscar'

export function BlueprintMigrationsPage() {
  const params = useParams()
  const modelId = Number(params.modelId)
  const navigate = useNavigate()
  const newVersionPath = `/database-models/${modelId}/migrations/new`

  // La pestaña vive en la URL, no en `useState`: así se puede enlazar y compartir «el estado
  // de este blueprint», y volver atrás no pierde dónde estabas. Mismo patrón que
  // `ManagedDatabaseMigrationsContent`, que ya guarda `?tab=` y `?reconcile=`.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: BlueprintTab =
    tabParam === 'estado'
      ? 'estado'
      : tabParam === 'contabilidad'
        ? 'contabilidad'
        : tabParam === 'buscar'
          ? 'buscar'
          : 'versiones'
  const setTab = (next: BlueprintTab) =>
    setSearchParams((params) => {
      if (next === 'versiones') params.delete('tab')
      else params.set('tab', next)
      return params
    })

  /*
   * La versión abierta vive en estado local, no en la URL: se cambia con flechas y con el
   * desplegable, y escribir cada paso en el histórico del navegador convertiría el «atrás» en un
   * deshacer de uno en uno.
   *
   * Lo que SÍ se lee de la URL es la versión de ARRANQUE, y por eso se resuelve en el
   * inicializador del `useState` —nunca en un `useEffect`, que sincronizar estado con props es
   * error de lint en este repo—. Sin esto no había forma de enlazar a una versión concreta desde
   * fuera, y el historial de una BD gestionada (v25 §5) la necesita: cada fila nombra la versión
   * que se aplicó y no tenía a dónde llevar.
   */
  const [selectedVersion, setSelectedVersion] = useState<string | null>(() =>
    searchParams.get('version'),
  )
  /**
   * Página **de la API**, no la que se muestra. Se guarda esta y no la de pantalla justamente
   * porque no depende de `pagination.pages`: la 1 es siempre la punta (el catálogo se pide
   * descendente), así que la pantalla abre sobre lo reciente sin un viaje previo para averiguar
   * cuántas páginas hay. La conversión a número de pantalla es `flipPage`, y solo hace falta al
   * renderizar, cuando `pages` ya llegó.
   */
  const [apiPage, setApiPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGINATION.maxSize)
  /**
   * Extremo a seleccionar cuando termine de cargar la página a la que se acaba de saltar con una
   * flecha. Sin esto, cruzar de página dejaría la selección en la versión más reciente de la
   * página nueva —el default— en vez de en la contigua a la que se venía mirando, que es un salto
   * de hasta 50 versiones en el gesto que sirve justamente para avanzar de a una.
   */
  const [pendingEdge, setPendingEdge] = useState<'oldest' | 'newest' | null>(null)
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
  /**
   * El catálogo se pide **descendente** (api-reference-v22 §2): así la PUNTA viene en la página 1
   * de la API y la pantalla abre sobre las versiones recientes, que es con las que se trabaja.
   * Con el orden ascendente por default, un blueprint de 53 versiones abría en la 50 y las tres
   * últimas quedaban fuera, sin ninguna forma de llegar a ellas.
   *
   * Los ítems se reordenan ascendente para mostrarlos y el número de página se invierte al
   * pintarlo (`flipPage`), así que en pantalla nada delata que por debajo se pide al revés.
   */
  const migrations = useModelMigrations(
    modelId,
    { page: apiPage, size: pageSize, order: 'desc' },
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
  /**
   * Catálogo COMPLETO, aparte de la página que se navega.
   *
   * La barra de avisos existe para ESCANEAR («¿qué versiones no tienen rollback?»), y un escaneo
   * que solo cubre la página visible no es un escaneo: diría «2 sin revisar» cuando hay nueve, sin
   * nada que lo delate. Por lo mismo sale de acá la punta que redacta la pista `not_tip`.
   *
   * Es una petición más (dos, con un historial de más de una página) contra un endpoint de solo
   * metadatos que no abre conexión a ningún motor. El navegador NO la usa: ese pagina, y traerse
   * el historial entero para pintar un desplegable sería pagar N peticiones por nada.
   */
  const catalog = useAllModelMigrations(modelId, Number.isFinite(modelId))
  const catalogSorted = useMemo(
    () => sortVersionsAscending(catalog.data?.items ?? []),
    [catalog.data],
  )

  const meta = migrations.data?.pagination
  const total = meta?.total ?? sorted.length
  const pages = meta?.pages ?? 1
  // Número de página tal como se muestra: la 1 son las más antiguas. Ver `flipPage`.
  const displayPage = flipPage(apiPage, pages)

  /**
   * Selecciona una versión, **saltando a su página si hace falta**.
   *
   * La barra de avisos lista versiones de todo el catálogo, así que puede señalar una que no está
   * en la página cargada. Sin este salto, `resolveVersionIndex` no la encontraría y caería en la
   * más reciente de la página: el clic mostraría OTRA versión sin decir nada, que es peor que no
   * poder pulsarlo.
   *
   * La página se calcula sobre el catálogo completo que ya está en memoria: la posición en el
   * orden DESCENDENTE (el que pide la API) dividida por el tamaño de página. Desde el navegador,
   * la versión ya está en la página actual y esto no hace nada.
   */
  const selectVersion = (version: string) => {
    setPendingEdge(null)
    setSelectedVersion(version)
    const ascIndex = catalogSorted.findIndex((m) => m.version === version)
    if (ascIndex === -1) return
    const descIndex = catalogSorted.length - 1 - ascIndex
    setApiPage(Math.floor(descIndex / pageSize) + 1)
  }

  const goToPage = (nextDisplayPage: number) => {
    setPendingEdge(null)
    setSelectedVersion(null)
    setApiPage(flipPage(nextDisplayPage, pages))
  }

  /**
   * Salto de página desde una flecha del navegador. En la API el orden es descendente, así que
   * ir hacia versiones más VIEJAS es avanzar de página y hacia las más nuevas es retroceder.
   *
   * El extremo que queda seleccionado es el contiguo al que se venía mirando —el más nuevo de la
   * página vieja, el más viejo de la nueva—, para que el gesto siga avanzando de a una versión y
   * no salte el ancho de una página entera.
   */
  const crossPage = (direction: 'older' | 'newer') => {
    setSelectedVersion(null)
    setPendingEdge(direction === 'older' ? 'newest' : 'oldest')
    setApiPage((current) => (direction === 'older' ? current + 1 : current - 1))
  }

  // Selección efectiva derivada (sin estado redundante, sin efecto de sincronización): la versión
  // elegida si sigue existiendo, o por defecto la MÁS RECIENTE — que es el estado actual del
  // blueprint y lo que el admin espera ver al entrar.
  //
  // `isPlaceholderData` (el `keepPreviousData` del hook) hace que durante el salto de página se
  // siga viendo la página anterior. Aplicar el extremo ahí seleccionaría el borde de la página
  // VIEJA, o sea un salto visible a una versión que nadie pidió, y otro al llegar la nueva.
  const edgeIndex = pendingEdge === 'oldest' ? 0 : sorted.length - 1
  const index =
    pendingEdge !== null && !migrations.isPlaceholderData && sorted.length > 0
      ? edgeIndex
      : resolveVersionIndex(sorted, selectedVersion)
  const selected = sorted[index] ?? null

  /*
   * ¿Se pidió una versión por `?version=` y no está en la página cargada?
   *
   * `resolveVersionIndex` cae a la punta cuando no la encuentra, y callar ahí es un fallo
   * silencioso: el catálogo se pide paginado, así que en un blueprint largo llegar desde el
   * historial de una BD a la `0003` abre la `0042` con la URL todavía diciendo `?version=0003`.
   * El operador cree estar mirando el evento que clicó y está mirando otro — exactamente la clase
   * de afirmación falsa que esta entrega existe para quitar.
   *
   * Se calcula sin efectos y solo con datos ya cargados: nada que sincronizar.
   */
  const requestedVersionMissing =
    selectedVersion !== null &&
    !migrations.isPlaceholderData &&
    sorted.length > 0 &&
    !sorted.some((item) => item.version === selectedVersion)

  // Versión punta. **Ya no es «la única que se puede eliminar»**: desde api-reference-v18 el
  // backend deja borrar cualquier versión, punta o intermedia —renumera las posteriores y mueve
  // el puntero de las BDs que estén más adelante—, así que ser la punta dejó de ser un requisito.
  //
  // Sigue haciendo falta para UNA cosa: redactar la pista del `block_reason` legado `not_tip`,
  // que solo devuelve un gateway anterior a v18.
  //
  // Sale del `is_latest` del backend, resuelto sobre TODO el catálogo (api-reference-v22 §3), y
  // ya no de la posición en la lista: con el catálogo paginado, el último ítem de la página no
  // es el último del blueprint, y nombrar la versión equivocada al lado del botón de borrar es
  // peor que no dar pista.
  const latestVersion = catalogSorted.find((m) => m.is_latest)?.version ?? null

  // Avisos del catálogo: lógica pura sobre el array ordenado, no sobre un `?? []` intermedio, que
  // crearía uno nuevo en cada render y dejaría el memo sin efecto.
  const alerts = useMemo(() => versionAlerts(catalogSorted), [catalogSorted])

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
        <TabButton active={tab === 'contabilidad'} onClick={() => setTab('contabilidad')}>
          Contabilidad de versiones
        </TabButton>
        <TabButton active={tab === 'buscar'} onClick={() => setTab('buscar')}>
          Buscar en el SQL
        </TabButton>
      </div>

      {tab === 'versiones' && requestedVersionMissing && (
        <Callout
          tone="warning"
          title={`La versión ${selectedVersion} no está en esta página del catálogo`}
        >
          <p>
            Se abrió la más reciente en su lugar. El catálogo se pide por páginas, así que esa
            versión puede estar en otra: buscala con el navegador de versiones.
          </p>
        </Callout>
      )}

      {tab === 'estado' ? (
        <ModelDatabasesStatusTable
          modelId={modelId}
          blueprintCollation={model.data.collation}
          onApplyTo={(database) => {
            setApplyTargets([database])
            setApplyAllOpen(true)
          }}
        />
      ) : tab === 'contabilidad' ? (
        /* Pestaña propia y no una sección de «Estado en las BDs»: esa tabla sale de datos locales
           del gateway y no abre conexiones, mientras que esta lee CADA motor y es 10/min. Juntarlas
           obligaría a una de las dos a heredar el coste de la otra. */
        <VersionTablesReportPanel modelId={modelId} />
      ) : tab === 'buscar' ? (
        /* El enlace del visor navega a `?version=` en esta MISMA ruta, y la página solo lee ese
           parámetro al montar: por eso además se selecciona a mano con `selectVersion`, que salta
           a la página del catálogo donde está la versión en vez de caer a la punta. */
        <MigrationSearchPanel modelId={modelId} onOpenInCatalog={selectVersion} />
      ) : (
        <>
          {/* Avisos del catálogo ANTES del selector: dicen si hay algo que resolver en el
              blueprint —versiones sin revisar que el apply va a rechazar, versiones sin rollback que
              romperían una reversión— y eso se decide antes de elegir una versión concreta. Es lo
              que repone el escaneo que daba la tabla eliminada. Si no hay avisos, no se pinta. */}
          {catalogSorted.length > 0 && (
            <VersionAlertsBar
              alerts={alerts}
              selectedVersion={selected?.version ?? null}
              onSelect={selectVersion}
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
              onSelect={selectVersion}
              pagination={{ page: displayPage, pages, total, size: pageSize }}
              onPageChange={goToPage}
              onSizeChange={(next) => {
                // Vuelve a la punta: con otro tamaño de página, el número anterior apunta a un
                // tramo distinto del historial y conservarlo dejaría al admin en un sitio que no
                // eligió. La punta es siempre la página 1 de la API.
                setPendingEdge(null)
                setSelectedVersion(null)
                setPageSize(next)
                setApiPage(1)
              }}
              onCrossPage={crossPage}
              isFetching={migrations.isFetching}
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
            // mismo rótulo. Por lo mismo se vuelve a la punta: el renumerado corre las versiones
            // entre páginas, así que la página en la que se estaba tampoco designa ya lo mismo.
            setSelectedVersion(null)
            setPendingEdge(null)
            setApiPage(1)
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
    case MIGRATION_ERROR_CODES.renumberPlanStale:
      return 'El plan quedó viejo: alguna base se movió entre la comprobación y ahora. No es un fallo tuyo y no hay nada que arreglar — vuelve a pedir el plan y confirma sobre el estado de ahora.'
    case MIGRATION_ERROR_CODES.renumberTargetMissing:
      return 'Al renumerar, alguna base quedaría apuntando a una versión que no figura en su historial. Revisa el historial de esas bases —lo habitual es que les falte aplicar migraciones— antes de volver a intentarlo.'
    default:
      return apiError.message
  }
}
