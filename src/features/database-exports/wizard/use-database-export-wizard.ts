import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type {
  ExportCapabilities,
  ExportObjectRef,
  ExportPreview,
  ExportSpec,
} from '@/lib/contracts'
import { PAGINATION } from '@/lib/contracts'
import { toApiError } from '@/lib/api/errors'
import { useCountdown } from '@/lib/utils/use-countdown'
import { useDebouncedValue } from '@/lib/utils/use-debounced-value'
import type { ExportSpecPayload } from '../api/database-exports.api'
import {
  EXPORT_TERMINAL_STATUSES,
  useDatabaseExport,
  useExportCapabilities,
  useExportDryRunPreview,
  useExportItems,
  useExportManifest,
  useExportObjects,
  useExportResolveSelection,
} from '../hooks/use-database-exports'
import {
  useCancelDatabaseExport,
  useCopyExportContent,
  useCreateDatabaseExport,
  useDownloadExportArtifact,
  useExecuteDatabaseExport,
  useExportPreview,
} from '../hooks/use-database-export-actions'
import {
  buildDefaultExportSpec,
  buildExportControls,
  buildExportSpecPayload,
  coerceOptionValue,
  evaluateExportMatrix,
  exportObjectKey,
  findDataWithoutStructure,
  hasImplicitContainer,
  isDataOnlyMode,
  isPartialArtifact,
  normalizeSpecForConstraints,
  previewSignature,
  toggleSelectionEntry,
  writeSpecValue,
  type ExportControl,
  type ExportMatrixEvaluation,
} from '../logic'
import { logExportFailure, warnAboutUnhandledErrorCodes } from '../messages'

/**
 * Estado completo del asistente de exportación. Sigue el patrón de wizard del repo
 * (`use-database-clone-wizard`, `use-collation-conversion-wizard`): un único hook dueño de TODO el
 * estado, con los pasos como vistas tontas que solo leen y escriben a través del objeto que
 * devuelve.
 *
 * Dos cosas que este asistente hace distinto de sus hermanos, y por qué:
 *
 * 1. **El formulario no conoce ninguna regla.** Cada control sale de `capabilities.options` y cada
 *    combinación prohibida, de `capabilities.compatibility`. Todo eso lo resuelve `logic.ts`; acá
 *    solo se guarda el spec y se le pasa el evaluador por encima en cada cambio.
 * 2. **El preview autoritativo va encadenado a la ejecución.** El `confirm_token` caduca por huella
 *    del catálogo, así que emitirlo justo antes de ejecutar vuelve raro el 409. La contrapartida es
 *    que ese preview puede devolver algo distinto de lo que el usuario acababa de leer, y ejecutar
 *    entonces sería hacerle confirmar lo que no vio: se compara la huella y, si cambió, se para y se
 *    le vuelve a pedir el visto bueno (`pendingReview`).
 */

export type ExportWizardStep = 'origin' | 'objects' | 'options' | 'confirm' | 'monitor'

/** Alcance del conjunto ESTRUCTURA: todo el catálogo, o los objetos que el usuario marque. */
export type SelectionScope = 'all' | 'custom'

/** Alcance del conjunto DATOS. `none` es el default: el caso seguro es no llevarse filas. */
export type DataScope = 'none' | 'all' | 'custom'

interface WizardOptions {
  serverId: number
  database: string
  /** `?jobId=` — reentrada directa al monitor de un job ya creado (recarga de página, enlace). */
  presetJobId?: number
}

/** Cuánto se bloquean las acciones tras un 429, para no gastar la siguiente ficha del rate limit. */
const RATE_LIMIT_COOLDOWN_MS = 5_000

/**
 * Cuánto se amortigua lo que el usuario teclea antes de consultar el motor. Los tres endpoints que
 * dependen del formulario (`objects`, `resolve-selection`, `preview`) están limitados a 10/min y
 * tocan la base: sin esto, escribir «pedidos» en el buscador serían siete llamadas y un 429.
 */
const TYPING_DEBOUNCE_MS = 400

/**
 * Spec inicial ya conciliado con la matriz. Los `default` que declara el gateway pueden chocar entre
 * sí para un motor o un formato concretos, y un spec inicial en violación deja el paso de opciones
 * con «Continuar» apagado y el control culpable deshabilitado — sin ninguna forma de arreglarlo
 * desde la interfaz.
 */
function buildNormalizedExportSpec(capabilities: ExportCapabilities): ExportSpec {
  const base = buildDefaultExportSpec(capabilities)
  return normalizeSpecForConstraints(base, capabilities, evaluateExportMatrix(base, capabilities))
}

export function useDatabaseExportWizard(options: WizardOptions): DatabaseExportWizard {
  const { serverId, database, presetJobId } = options
  const [searchParams, setSearchParams] = useSearchParams()

  const [step, setStep] = useState<ExportWizardStep>(presetJobId != null ? 'monitor' : 'origin')
  const [jobId, setJobId] = useState<number | null>(presetJobId ?? null)

  const [spec, setSpec] = useState<ExportSpec | null>(null)
  const [selectionScope, setSelectionScopeState] = useState<SelectionScope>('all')
  const [dataScope, setDataScopeState] = useState<DataScope>('none')
  const [structureChecked, setStructureChecked] = useState<Map<string, ExportObjectRef>>(new Map())
  const [dataChecked, setDataChecked] = useState<Map<string, string>>(new Map())

  const [objectsPage, setObjectsPage] = useState(1)
  const [objectTypeFilter, setObjectTypeFilterState] = useState<string | null>(null)
  const [nameLike, setNameLikeState] = useState('')
  const [autoResolveDependencies, setAutoResolveDependencies] = useState(false)

  const [confirmTargetName, setConfirmTargetName] = useState('')
  /**
   * Clave de idempotencia atada al spec con el que se intentó crear el plan. Se guarda junto a la
   * huella del cuerpo porque el contrato distingue dos casos: **la misma clave con el mismo spec**
   * devuelve el plan ya creado (lo que protege de un reintento de red), pero **la misma clave con
   * otro spec** es un `409 export.idempotency_conflict`. Reutilizarla a ciegas tras cambiar el
   * formato garantizaba ese 409.
   */
  const [planAttempt, setPlanAttempt] = useState<{ key: string; fingerprint: string } | null>(null)
  /**
   * Preview autoritativo cuya huella NO coincide con lo que el usuario había leído. Mientras esté
   * puesto, la ejecución queda parada y el paso de confirmación muestra ESTE preview.
   */
  const [pendingReview, setPendingReview] = useState<ExportPreview | null>(null)

  const [itemsPage, setItemsPage] = useState(1)
  const [actionCooldown, setActionCooldown] = useState(false)
  // Referencia y no estado: solo sirve para reprogramar el temporizador del 429, nunca se renderiza.
  const cooldownTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  // ── Capacidades: la única fuente del formulario ───────────────────────────────
  const capabilities = useExportCapabilities(serverId, database, true)
  const capabilitiesData = capabilities.data ?? null

  /**
   * Si el backend declara códigos de error que `messages.ts` no traduce, se avisa en consola. Va en
   * un memo para que se haga una vez por respuesta y no en cada render.
   */
  const unhandledErrorCodes = useMemo(
    () => (capabilitiesData ? warnAboutUnhandledErrorCodes(capabilitiesData) : []),
    [capabilitiesData],
  )

  /**
   * Prellenado del spec en cuanto llegan las capacidades, con el patrón "ajustar estado durante el
   * render" en lugar de un efecto: en este repo `setState` dentro de `useEffect` es un error de lint
   * (`react-hooks`), y aquí además ahorraría un ciclo en el que el formulario no tendría qué pintar.
   */
  if (spec === null && capabilitiesData) {
    setSpec(buildNormalizedExportSpec(capabilitiesData))
  }

  const controls = useMemo<ExportControl[]>(
    () => (capabilitiesData ? buildExportControls(capabilitiesData) : []),
    [capabilitiesData],
  )

  // ── Spec efectivo: el spec del formulario + los dos conjuntos del árbol ────────
  /**
   * Los modos y nombres de `selection`/`data` se derivan del árbol en vez de duplicarse en el spec:
   * una sola verdad (lo que el usuario marcó) y ningún riesgo de que las dos copias se separen.
   */
  const effectiveSpec = useMemo<ExportSpec | null>(() => {
    if (!spec) return null
    const structureNames = [...structureChecked.values()].map((ref) => ref.name)
    return {
      ...spec,
      selection: {
        ...spec.selection,
        mode: selectionScope === 'all' ? 'all' : 'include',
        // Con `mode: 'include'` los nombres ya identifican los objetos uno a uno. Mandar además los
        // `types` derivados de esa selección es redundante en el mejor caso y peligroso en el peor:
        // si el backend uniera `types` con `names` en vez de filtrar, marcar dos tablas exportaría
        // TODAS las tablas. El contrato solo manda `names` en su propio ejemplo de `include`.
        types: selectionScope === 'all' ? spec.selection.types : [],
        names: selectionScope === 'all' ? [] : structureNames,
      },
      data: {
        ...spec.data,
        mode: dataScope === 'custom' ? 'include' : dataScope,
        names: dataScope === 'custom' ? [...dataChecked.values()] : [],
      },
    }
  }, [spec, selectionScope, dataScope, structureChecked, dataChecked])

  const evaluation = useMemo<ExportMatrixEvaluation | null>(
    () =>
      effectiveSpec && capabilitiesData
        ? evaluateExportMatrix(effectiveSpec, capabilitiesData)
        : null,
    [effectiveSpec, capabilitiesData],
  )

  /** Cuerpo listo para `create`/`preview`. Estable por referencia: lo exige el `useDeferredValue`. */
  const specPayload = useMemo<ExportSpecPayload | null>(
    () =>
      effectiveSpec && capabilitiesData
        ? buildExportSpecPayload(effectiveSpec, capabilitiesData)
        : null,
    [effectiveSpec, capabilitiesData],
  )

  const dataOnly = effectiveSpec ? isDataOnlyMode(effectiveSpec) : false
  const structureNameSet = useMemo(
    () => new Set([...structureChecked.values()].map((ref) => ref.name)),
    [structureChecked],
  )
  /**
   * Tablas con datos cuya estructura quedó fuera. Se detecta acá para ofrecer las dos salidas del
   * contrato (agregarlas a la estructura o pasar a "solo datos") en vez de esperar el 422.
   */
  const dataWithoutStructure = useMemo(
    () =>
      selectionScope === 'custom' && dataScope !== 'none'
        ? findDataWithoutStructure(structureNameSet, dataChecked.values(), dataOnly)
        : [],
    [selectionScope, dataScope, structureNameSet, dataChecked, dataOnly],
  )

  /**
   * «Todas las tablas» para datos con una estructura elegida a mano es una combinación que el
   * cliente no puede validar: `dataChecked` está vacío en ese modo, así que no hay nada contra lo
   * que comparar y `data ⊆ selection` se violaría sin que la pantalla lo detecte — el usuario vería
   * la promesa «se exportan las filas de todas las tablas» y recibiría un 422 más tarde.
   *
   * En modo "solo datos" sí es legítima: ahí la restricción no existe.
   */
  const dataAllBlocked = selectionScope === 'custom' && !dataOnly

  const implicitZip = useMemo(
    () =>
      effectiveSpec && capabilitiesData
        ? hasImplicitContainer(effectiveSpec, capabilitiesData)
        : false,
    [effectiveSpec, capabilitiesData],
  )

  // ── Catálogo de objetos ───────────────────────────────────────────────────────
  // El buscador va amortiguado: `name_like` alimenta un endpoint 🔌 de 10/min, así que una llamada
  // por pulsación agota la cuota a media palabra.
  const debouncedNameLike = useDebouncedValue(nameLike, TYPING_DEBOUNCE_MS)
  const objectsParams = useMemo(
    () => ({
      page: objectsPage,
      size: PAGINATION.defaultSize,
      object_type: objectTypeFilter,
      name_like: debouncedNameLike.trim().length > 0 ? debouncedNameLike.trim() : undefined,
    }),
    [objectsPage, objectTypeFilter, debouncedNameLike],
  )
  const objects = useExportObjects(jobId ?? 0, objectsParams, jobId != null && step === 'objects')

  // ── Cierre de dependencias ────────────────────────────────────────────────────
  /**
   * Se mandan los bloques COMPLETOS, con sus patrones incluidos. Recortarlos a `mode` + `names`
   * haría que el backend resolviese el cierre de dependencias de un conjunto distinto del que
   * después se exporta —los `include_patterns`/`exclude_patterns` cambian qué entra— y las
   * dependencias que faltasen se descubrirían recién en el preview.
   */
  const resolveBody = useMemo(
    () =>
      effectiveSpec
        ? {
            selection: effectiveSpec.selection,
            data: effectiveSpec.data,
            auto_resolve_dependencies: autoResolveDependencies,
          }
        : null,
    [effectiveSpec, autoResolveDependencies],
  )
  const closure = useExportResolveSelection(
    jobId ?? 0,
    resolveBody,
    jobId != null && step === 'objects' && selectionScope === 'custom',
  )

  // ── Panel vivo de consecuencias ───────────────────────────────────────────────
  const dryRun = useExportDryRunPreview(
    jobId ?? 0,
    specPayload,
    autoResolveDependencies,
    jobId != null && (step === 'options' || step === 'confirm'),
  )

  // ── Job ───────────────────────────────────────────────────────────────────────
  const job = useDatabaseExport(jobId ?? 0, jobId != null)
  const jobStatus = job.data?.status ?? null
  const jobIsTerminal = jobStatus != null && EXPORT_TERMINAL_STATUSES.has(jobStatus)

  const itemsParams = useMemo(
    () => ({ page: itemsPage, size: PAGINATION.defaultSize }),
    [itemsPage],
  )
  // Los ítems se escriben de una sola vez al terminar el job: pedirlos antes devuelve lista vacía y
  // mostraría «0 incidencias» durante toda la exportación, que es lo contrario de la verdad.
  const items = useExportItems(jobId ?? 0, itemsParams, jobId != null && jobIsTerminal)
  const manifest = useExportManifest(jobId ?? 0, jobId != null && jobIsTerminal)

  /**
   * Lo que le queda al ARTEFACTO antes de purgarse (30 min desde que el job termina) — que es un
   * plazo distinto del PLAN (24 h). Se lee del `expires_at` del manifiesto, no de un temporizador
   * local: el TTL empieza a correr en el servidor.
   */
  const artifactExpiresAt = manifest.data?.expires_at ?? null
  const artifactRemainingMs = useCountdown(artifactExpiresAt)

  /**
   * El artefacto se purgó. Se separa de `artifactRemainingMs <= 0` a propósito: ese contador vale 0
   * también cuando **no hay fecha** —el manifiesto todavía no cargó, o el job no produjo artefacto—,
   * y leerlo a secas deshabilitaría la descarga de un artefacto perfectamente válido durante el
   * primer render. Sin fecha se asume vigente y se deja que el 410 lo explique: bloquear una acción
   * legítima es peor que un error honesto.
   */
  const artifactExpired = artifactExpiresAt != null && artifactRemainingMs <= 0

  const partialArtifact = isPartialArtifact({
    statusIsTerminal: jobIsTerminal,
    complete: manifest.data?.complete,
  })

  // ── Mutaciones ────────────────────────────────────────────────────────────────
  const createPlanMutation = useCreateDatabaseExport(serverId, database)
  const previewMutation = useExportPreview(jobId ?? 0)
  const execute = useExecuteDatabaseExport(jobId ?? 0)
  const cancel = useCancelDatabaseExport(jobId ?? 0)
  const download = useDownloadExportArtifact(jobId ?? 0)
  const copyContent = useCopyExportContent(jobId ?? 0)

  /**
   * Arranca el enfriamiento tras un 429 y registra el fallo con su `X-Request-ID`, que es la única
   * forma de que el backend correlacione el intento con su traza.
   */
  const handleFailure = useCallback((error: unknown, context: string) => {
    const apiError = toApiError(error)
    logExportFailure(apiError, context)
    if (!apiError.isRateLimited) return
    setActionCooldown(true)
    if (cooldownTimerRef.current != null) window.clearTimeout(cooldownTimerRef.current)
    cooldownTimerRef.current = window.setTimeout(
      () => setActionCooldown(false),
      RATE_LIMIT_COOLDOWN_MS,
    )
  }, [])

  /** Limpia todo lo que pertenece a un job concreto, para que no se filtre al siguiente. */
  const resetJobScopedState = useCallback(() => {
    setStructureChecked(new Map())
    setDataChecked(new Map())
    setSelectionScopeState('all')
    setDataScopeState('none')
    setObjectsPage(1)
    setObjectTypeFilterState(null)
    setNameLikeState('')
    setAutoResolveDependencies(false)
    setConfirmTargetName('')
    setPendingReview(null)
    setItemsPage(1)
    setActionCooldown(false)
    if (cooldownTimerRef.current != null) window.clearTimeout(cooldownTimerRef.current)
    // Los errores de una mutación sobreviven al cambio de job: sin este reset, el plan nuevo
    // mostraría el fallo del anterior antes de que el usuario haya intentado nada.
    previewMutation.reset()
    execute.reset()
    cancel.reset()
    download.reset()
    copyContent.reset()
  }, [previewMutation, execute, cancel, download, copyContent])

  // ── Escritura del spec ────────────────────────────────────────────────────────
  /**
   * Escribe una ruta del spec y **re-normaliza contra la matriz en el mismo paso**. Normalizar acá y
   * no solo al enviar es lo que hace que elegir `csv` apague de verdad la estructura: si el valor
   * prohibido siguiera vivo detrás de un control deshabilitado, se enviaría igual y el 422 llegaría
   * de todas formas.
   */
  const setSpecValue = useCallback(
    (path: string, value: unknown) => {
      setSpec((previous) => {
        if (!previous || !capabilitiesData) return previous
        let next = writeSpecValue(previous, path, value)

        // Salir de `DROP_CREATE` borra el nombre re-tecleado. Conservarlo tiene dos consecuencias
        // malas: viaja en el payload de una exportación que ya no borra nada, y —lo grave— al volver
        // a `DROP_CREATE` el campo reaparece YA RELLENADO y el `requires` se satisface solo. Eso
        // anula la doble confirmación, que es la única barrera antes de un DROP DATABASE.
        if (path === 'structure.scope_ddl' && value !== 'DROP_CREATE') {
          next = writeSpecValue(next, 'structure.confirm_scope_drop', null)
        }

        return normalizeSpecForConstraints(
          next,
          capabilitiesData,
          evaluateExportMatrix(next, capabilitiesData),
        )
      })
    },
    [capabilitiesData],
  )

  /** Escribe el valor crudo de un control resolviendo la asimetría boolean/string de `options`. */
  const setOptionValue = useCallback(
    (path: string, raw: string) => {
      const option = capabilitiesData?.options[path]
      setSpecValue(path, option ? coerceOptionValue(option, raw) : raw)
    },
    [capabilitiesData, setSpecValue],
  )

  const setFormat = useCallback((format: string) => setSpecValue('format', format), [setSpecValue])

  // ── Selección ─────────────────────────────────────────────────────────────────
  const toggleStructureObject = useCallback((ref: ExportObjectRef) => {
    setStructureChecked((previous) =>
      toggleSelectionEntry(previous, exportObjectKey(ref.object_type, ref.name), ref),
    )
  }, [])

  const toggleDataTable = useCallback((name: string) => {
    setDataChecked((previous) => toggleSelectionEntry(previous, name, name))
  }, [])

  // `setDataScope` se declara ANTES de `setSelectionScope`, que lo usa: son dos `const`, así que el
  // orden inverso daría un error de zona muerta temporal en el primer clic.
  const setDataScope = useCallback(
    (scope: DataScope) => {
      setDataScopeState(scope)
      if (scope === 'custom') return
      setDataChecked(new Map())
      // Los filtros por tabla se van con las tablas. Dejarlos haría que el backend devolviese el
      // aviso «hay un `where` definido para una tabla que no está en la selección de datos» por unos
      // filtros que el usuario ya abandonó.
      setSpecValue('data.per_object', {})
    },
    [setSpecValue],
  )

  const setSelectionScope = useCallback(
    (scope: SelectionScope) => {
      setSelectionScopeState(scope)
      if (scope === 'all') {
        setStructureChecked(new Map())
        return
      }
      // Al pasar la estructura a "elegir a mano", «Todas las tablas» deja de ser ofrecible (ver
      // `dataAllBlocked`). Sin este reset la combinación quedaría viva con su control ya
      // deshabilitado: imposible de cambiar y con un 422 esperando al final.
      if (dataScope === 'all' && !dataOnly) setDataScope('custom')
    },
    [dataScope, dataOnly, setDataScope],
  )

  const setObjectTypeFilter = useCallback((type: string | null) => {
    setObjectTypeFilterState(type)
    setObjectsPage(1)
  }, [])

  const setNameLike = useCallback((value: string) => {
    setNameLikeState(value)
    setObjectsPage(1)
  }, [])

  /** Reintenta el cierre de dependencias pidiendo al backend que agregue lo que falta. */
  const resolveMissingDependencies = useCallback(() => setAutoResolveDependencies(true), [])

  /** Añade a la estructura las tablas que se marcaron para datos y quedaron huérfanas. */
  const adoptDataTablesIntoStructure = useCallback(() => {
    setStructureChecked((previous) => {
      const next = new Map(previous)
      for (const table of dataWithoutStructure) {
        next.set(exportObjectKey('table', table), { object_type: 'table', name: table })
      }
      return next
    })
  }, [dataWithoutStructure])

  /** Pasa a modo "solo datos", la otra salida del 422 `export.data_without_structure`. */
  const switchToDataOnly = useCallback(() => {
    setSpecValue('structure.scope_ddl', 'NONE')
    setSpecValue('structure.entity_ddl', 'NONE')
  }, [setSpecValue])

  /** Pasa la entrega a archivo, la salida del 409 `export.inline_too_large`. */
  const switchToFileDelivery = useCallback(
    () => setSpecValue('output.delivery', 'file'),
    [setSpecValue],
  )

  // ── Crear el plan ─────────────────────────────────────────────────────────────
  /**
   * Crea el plan. Es lo que habilita el catálogo (`/objects` cuelga del job), así que ocurre al
   * salir del primer paso y no al final.
   *
   * La `idempotency_key` se genera acá —en el manejador, nunca en render: `crypto.randomUUID()` es
   * impuro y `react-hooks/purity` lo marca— para que un doble clic o un reintento de red devuelvan
   * el plan ya creado en vez de un segundo plan huérfano.
   */
  const createPlan = useCallback(() => {
    // El plan ya existe: volver al paso 1, cambiar algo y seguir NO crea otro. El `preview`
    // reemplaza el spec del plan, y recrearlo aquí llamaría a `resetJobScopedState`, que borraría
    // en silencio la selección del árbol que el usuario ya había hecho.
    if (jobId != null) {
      setStep('objects')
      return
    }
    if (!specPayload) return

    const fingerprint = JSON.stringify(specPayload)
    const key = planAttempt?.fingerprint === fingerprint ? planAttempt.key : crypto.randomUUID()
    setPlanAttempt({ key, fingerprint })

    createPlanMutation.mutate(
      { ...specPayload, idempotency_key: key },
      {
        onSuccess: (summary) => {
          resetJobScopedState()
          setJobId(summary.id)
          setStep('objects')
        },
        onError: (error) => handleFailure(error, 'crear el plan'),
      },
    )
  }, [jobId, specPayload, planAttempt, createPlanMutation, resetJobScopedState, handleFailure])

  // ── Confirmar y ejecutar ──────────────────────────────────────────────────────
  const nameMatches = confirmTargetName === database
  const hasBlockingViolations = (evaluation?.violations.length ?? 0) > 0
  /** El preview que el paso de confirmación muestra: el que hay que revisar, o el panel vivo. */
  const confirmPreview = pendingReview ?? dryRun.data ?? null

  const submitDisabled =
    jobId == null ||
    !nameMatches ||
    hasBlockingViolations ||
    actionCooldown ||
    previewMutation.isPending ||
    execute.isPending ||
    // Un `dry_run` obsoleto describe otra configuración: comparar contra él no detectaría nada.
    dryRun.isStale ||
    dryRun.isFetching ||
    dryRun.data == null

  /**
   * Emite el preview autoritativo y, si describe lo mismo que el usuario acaba de leer, ejecuta con
   * ese token recién emitido. Si describe otra cosa, para: `pendingReview` queda puesto y el paso
   * muestra el preview nuevo para que lo apruebe explícitamente.
   */
  const submitExport = useCallback(() => {
    if (submitDisabled || !specPayload) return
    const reviewed = dryRun.data ? previewSignature(dryRun.data) : null
    setPendingReview(null)

    previewMutation.mutate(
      { spec: specPayload, auto_resolve_dependencies: autoResolveDependencies },
      {
        onSuccess: (fresh) => {
          if (reviewed != null && previewSignature(fresh) !== reviewed) {
            setPendingReview(fresh)
            return
          }
          if (fresh.confirm_token == null) return
          execute.mutate(
            { confirm_target_name: database, confirm_token: fresh.confirm_token },
            {
              onSuccess: () => setStep('monitor'),
              onError: (error) => handleFailure(error, 'ejecutar la exportación'),
            },
          )
        },
        onError: (error) => handleFailure(error, 'previsualizar la exportación'),
      },
    )
  }, [
    submitDisabled,
    specPayload,
    dryRun.data,
    previewMutation,
    autoResolveDependencies,
    execute,
    database,
    handleFailure,
  ])

  /** Confirma la exportación con el preview que cambió, después de que el usuario lo revisó. */
  const confirmAfterReview = useCallback(() => {
    const token = pendingReview?.confirm_token
    // Se revalidan las mismas barreras que `submitExport`: revisar un preview no exime de que el
    // spec siga siendo válido ni de que el nombre siga re-tecleado.
    if (token == null || !nameMatches || hasBlockingViolations || actionCooldown) return
    execute.mutate(
      { confirm_target_name: database, confirm_token: token },
      {
        onSuccess: () => {
          setPendingReview(null)
          setStep('monitor')
        },
        onError: (error) => handleFailure(error, 'ejecutar la exportación revisada'),
      },
    )
  }, [
    pendingReview,
    nameMatches,
    hasBlockingViolations,
    actionCooldown,
    execute,
    database,
    handleFailure,
  ])

  const cancelExport = useCallback(() => {
    cancel.mutate(undefined, { onError: (error) => handleFailure(error, 'cancelar') })
  }, [cancel, handleFailure])

  const downloadArtifact = useCallback(() => {
    download.mutate(undefined, { onError: (error) => handleFailure(error, 'descargar') })
  }, [download, handleFailure])

  const copyArtifact = useCallback(() => {
    copyContent.mutate(undefined, { onError: (error) => handleFailure(error, 'copiar') })
  }, [copyContent, handleFailure])

  // ── Navegación ────────────────────────────────────────────────────────────────
  /**
   * El orden es fijo (el contrato describe cuatro pasos más el monitor) pero el paso de objetos
   * necesita un plan creado, así que `next` no salta: el primer paso avanza creando el plan.
   */
  const order = useMemo<ExportWizardStep[]>(
    () => ['origin', 'objects', 'options', 'confirm', 'monitor'],
    [],
  )

  /**
   * Toda navegación descarta un `pendingReview` pendiente. Su `confirm_token` describe una selección
   * congelada concreta: si el usuario se va a editar objetos u opciones y vuelve, ese botón
   * «Revisado, exportar» seguiría ahí y ejecutaría el plan VIEJO, ignorando en silencio todo lo que
   * acaba de cambiar.
   */
  const goToStep = useCallback((next: ExportWizardStep) => {
    setPendingReview(null)
    setStep(next)
  }, [])

  const next = useCallback(() => {
    setPendingReview(null)
    setStep((current) => {
      const index = order.indexOf(current)
      // El monitor es terminal: no se avanza más allá ni se vuelve desde él por navegación normal.
      if (index === -1 || index >= order.length - 2) return current
      return order[index + 1]!
    })
  }, [order])

  const back = useCallback(() => {
    setPendingReview(null)
    setStep((current) => {
      const index = order.indexOf(current)
      return index <= 0 ? current : order[index - 1]!
    })
  }, [order])

  const canBack = order.indexOf(step) > 0 && step !== 'monitor'

  /** Empieza de cero: plan nuevo sobre la misma base. Un plan es de un solo uso. */
  const reset = useCallback(() => {
    // Con `?jobId=` en la URL basta con quitarlo: la página lleva ese parámetro en su `key`, así que
    // el asistente se remonta limpio. Sin esto, un F5 tras «Volver a exportar» devolvería al monitor
    // del job viejo, que es justo el que acabamos de abandonar.
    if (searchParams.get('jobId') != null) {
      const next = new URLSearchParams(searchParams)
      next.delete('jobId')
      setSearchParams(next, { replace: true })
      return
    }
    resetJobScopedState()
    createPlanMutation.reset()
    setJobId(null)
    setPlanAttempt(null)
    setSpec(capabilitiesData ? buildNormalizedExportSpec(capabilitiesData) : null)
    setStep('origin')
  }, [searchParams, setSearchParams, resetJobScopedState, createPlanMutation, capabilitiesData])

  return {
    // contexto
    serverId,
    database,

    // navegación
    step,
    order,
    canBack,
    next,
    back,
    goToStep,

    // capacidades y spec
    capabilities,
    spec,
    effectiveSpec,
    controls,
    evaluation,
    unhandledErrorCodes,
    setSpecValue,
    setOptionValue,
    setFormat,

    // señales derivadas
    dataOnly,
    dataWithoutStructure,
    dataAllBlocked,
    implicitZip,
    hasBlockingViolations,

    // plan
    jobId,
    createPlan: createPlanMutation,
    submitPlan: createPlan,

    // selección
    selectionScope,
    dataScope,
    setSelectionScope,
    setDataScope,
    structureChecked,
    dataChecked,
    toggleStructureObject,
    toggleDataTable,
    objects,
    objectsPage,
    setObjectsPage,
    objectTypeFilter,
    setObjectTypeFilter,
    nameLike,
    setNameLike,
    closure,
    resolveMissingDependencies,
    adoptDataTablesIntoStructure,
    switchToDataOnly,
    switchToFileDelivery,

    // confirmación
    dryRun,
    confirmPreview,
    pendingReview,
    confirmTargetName,
    setConfirmTargetName,
    nameMatches,
    submitDisabled,
    submitExport,
    confirmAfterReview,
    preview: previewMutation,
    execute,

    // monitor y resultado
    job,
    jobIsTerminal,
    items,
    itemsPage,
    setItemsPage,
    manifest,
    artifactRemainingMs,
    artifactExpired,
    partialArtifact,
    cancel,
    cancelExport,
    download,
    downloadArtifact,
    copyContent,
    copyArtifact,

    // recuperación
    actionCooldown,
    reset,
  }
}

export interface DatabaseExportWizard {
  // ── contexto ──
  serverId: number
  database: string

  // ── navegación ──
  step: ExportWizardStep
  order: ExportWizardStep[]
  canBack: boolean
  next: () => void
  back: () => void
  goToStep: (step: ExportWizardStep) => void

  // ── capacidades y spec ──
  capabilities: ReturnType<typeof useExportCapabilities>
  /** El spec del formulario. `null` hasta que llegan las capacidades. */
  spec: ExportSpec | null
  /** El spec con los dos conjuntos ya derivados del árbol. Es el que se evalúa y se envía. */
  effectiveSpec: ExportSpec | null
  controls: ExportControl[]
  evaluation: ExportMatrixEvaluation | null
  /** Códigos que el backend declara y la UI no traduce. Diagnóstico, no se muestra al usuario. */
  unhandledErrorCodes: string[]
  setSpecValue: (path: string, value: unknown) => void
  setOptionValue: (path: string, raw: string) => void
  setFormat: (format: string) => void

  // ── señales derivadas ──
  dataOnly: boolean
  dataWithoutStructure: string[]
  /** «Todas las tablas» para datos no es ofrecible con la estructura elegida a mano: ver el hook. */
  dataAllBlocked: boolean
  implicitZip: boolean
  hasBlockingViolations: boolean

  // ── plan ──
  jobId: number | null
  createPlan: ReturnType<typeof useCreateDatabaseExport>
  submitPlan: () => void

  // ── selección ──
  selectionScope: SelectionScope
  dataScope: DataScope
  setSelectionScope: (scope: SelectionScope) => void
  setDataScope: (scope: DataScope) => void
  structureChecked: Map<string, ExportObjectRef>
  dataChecked: Map<string, string>
  toggleStructureObject: (ref: ExportObjectRef) => void
  toggleDataTable: (name: string) => void
  objects: ReturnType<typeof useExportObjects>
  objectsPage: number
  setObjectsPage: (page: number) => void
  objectTypeFilter: string | null
  setObjectTypeFilter: (type: string | null) => void
  nameLike: string
  setNameLike: (value: string) => void
  closure: ReturnType<typeof useExportResolveSelection>
  resolveMissingDependencies: () => void
  adoptDataTablesIntoStructure: () => void
  switchToDataOnly: () => void
  switchToFileDelivery: () => void

  // ── confirmación ──
  dryRun: ReturnType<typeof useExportDryRunPreview>
  /** El preview que se muestra: el que hay que revisar si cambió, o el del panel vivo. */
  confirmPreview: ExportPreview | null
  /** Puesto = el preview autoritativo describe otra cosa y la ejecución está parada. */
  pendingReview: ExportPreview | null
  confirmTargetName: string
  setConfirmTargetName: (value: string) => void
  nameMatches: boolean
  submitDisabled: boolean
  submitExport: () => void
  confirmAfterReview: () => void
  preview: ReturnType<typeof useExportPreview>
  execute: ReturnType<typeof useExecuteDatabaseExport>

  // ── monitor y resultado ──
  job: ReturnType<typeof useDatabaseExport>
  jobIsTerminal: boolean
  items: ReturnType<typeof useExportItems>
  itemsPage: number
  setItemsPage: (page: number) => void
  manifest: ReturnType<typeof useExportManifest>
  /** Milisegundos que le quedan al ARTEFACTO (no al plan) antes de purgarse. */
  artifactRemainingMs: number
  /**
   * El artefacto venció. **Usá esto para deshabilitar la descarga, no `artifactRemainingMs <= 0`**:
   * el contador también vale 0 cuando todavía no hay fecha.
   */
  artifactExpired: boolean
  partialArtifact: boolean
  cancel: ReturnType<typeof useCancelDatabaseExport>
  cancelExport: () => void
  download: ReturnType<typeof useDownloadExportArtifact>
  downloadArtifact: () => void
  copyContent: ReturnType<typeof useCopyExportContent>
  copyArtifact: () => void

  // ── recuperación ──
  actionCooldown: boolean
  reset: () => void
}
