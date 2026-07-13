import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toApiError } from '@/lib/api/errors'
import {
  type AdoptComparisonOut,
  type EngineType,
  type ExecuteComparisonOut,
  type ExecuteMode,
  type SchemaChangeType,
  type SchemaObjectType,
  type ServerOut,
} from '@/lib/contracts'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useReconcile } from '@/features/servers/hooks/use-reconcile'
import {
  useManagedDatabase,
  useManagedDatabaseOptions,
  useManagedDatabasesByServer,
} from '@/features/managed-databases/hooks/use-managed-databases'
import {
  useAllSchemaComparisonItems,
  useExecutePreview,
  useSchemaComparison,
  useSchemaComparisonItems,
} from '../hooks/use-schema-comparisons'
import {
  useAdoptComparison,
  useCreateSchemaComparison,
  useExecuteComparison,
} from '../hooks/use-schema-comparison-actions'
import {
  buildAdoptBody,
  buildCreateComparisonBody,
  buildExecuteBody,
  ENGINES_BY_FAMILY,
  isCrossFlavorPair,
  managedDatabasesToOptions,
  reconcileItemsToOptions,
  resolveDatabaseEngine,
  resolveEngineFamily,
  resolveShortcutSelection,
  pendingIndividualReviewIds,
  type DatabaseSideOption,
  type EngineFamily,
  type SelectionShortcut,
} from './logic'

export type WizardStep =
  | 'selector'
  | 'summary'
  | 'items'
  | 'adoptSelect'
  | 'adoptConfirm'
  | 'executeSelect'
  | 'executeConfirm'
  | 'result'

type StageKey = 'selector' | 'summary' | 'action'

/** Etapas del indicador de pasos. `items` cae bajo "Resumen"; las 4 vistas de acción, bajo "Acción". */
export const WIZARD_STAGES: { key: StageKey; label: string }[] = [
  { key: 'selector', label: 'Selector' },
  { key: 'summary', label: 'Resumen' },
  { key: 'action', label: 'Acción' },
]

const STAGE_KEY_BY_STEP: Record<WizardStep, StageKey> = {
  selector: 'selector',
  summary: 'summary',
  items: 'summary',
  adoptSelect: 'action',
  adoptConfirm: 'action',
  executeSelect: 'action',
  executeConfirm: 'action',
  result: 'action',
}

/** Modo del selector (Vista 1): "por motor" (BDs adoptadas, comportamiento original) o "por
 * servidor" (feature "referencias crudas": incluye BDs vivas del motor sin registrar). */
export type SelectionMode = 'family' | 'server'

export type WizardResult =
  | { kind: 'adopt'; data: AdoptComparisonOut }
  | { kind: 'execute'; data: ExecuteComparisonOut }

interface WizardOptions {
  /** Prellenado desde la fila "Comparar esquema" de una BD gestionada (`?targetDatabaseId=`). */
  presetTargetId?: number
}

export interface SchemaComparisonWizard {
  // ── Navegación ──────────────────────────────────────────────────────────────
  step: WizardStep
  order: WizardStep[]
  stageIndex: number
  canBack: boolean
  next: () => void
  back: () => void
  goToStep: (step: WizardStep) => void
  /** Paso de entrada de la rama activa (Opción A o B); `null` mientras no se conoce el target. */
  actionEntryStep: 'adoptSelect' | 'executeSelect' | null

  // ── Selector (Vista 1) ────────────────────────────────────────────────────────
  selectionMode: SelectionMode
  setSelectionMode: (mode: SelectionMode) => void
  /** Modo "por motor": BDs adoptadas del motor/familia elegida (comportamiento original). */
  family: EngineFamily | null
  setFamily: (family: EngineFamily | null) => void
  /** Modo "por servidor": servidor elegido, cuya lista combina adoptadas + BDs sin registrar. */
  serverOptions: ReturnType<typeof useServerOptions>
  pickerServerId: number | null
  setPickerServerId: (serverId: number | null) => void
  options: DatabaseSideOption[]
  optionsLoading: boolean
  optionsError: unknown
  refetchOptions: () => void
  sourceSelection: DatabaseSideOption | null
  targetSelection: DatabaseSideOption | null
  setSourceSelection: (option: DatabaseSideOption | null) => void
  setTargetSelection: (option: DatabaseSideOption | null) => void
  sourceOptions: DatabaseSideOption[]
  targetOptions: DatabaseSideOption[]
  crossFlavorWarning: boolean
  createComparison: () => void
  createComparisonState: ReturnType<typeof useCreateSchemaComparison>

  // ── Comparación (Vistas 2/3) ─────────────────────────────────────────────────
  comparisonId: number | null
  summary: ReturnType<typeof useSchemaComparison>
  /** Verdad viva sobre el blueprint del target — determina la rama Opción A/B. `undefined` si
   * el target no está en el inventario (BD cruda): no hay nada que consultar. */
  targetDetail: ReturnType<typeof useManagedDatabase>
  /** Motor real del target (siempre poblado en la respuesta de la comparación). */
  targetEngine: EngineType | undefined
  /** Nombre físico de cada lado — siempre poblado, sea BD adoptada o cruda (§ referencias crudas). */
  sourceName: string | null
  targetName: string | null
  itemsPage: number
  itemsSize: number
  itemsObjectType: SchemaObjectType | null
  itemsChangeType: SchemaChangeType | null
  setItemsPage: (page: number) => void
  setItemsSize: (size: number) => void
  setItemsObjectType: (value: SchemaObjectType | null) => void
  setItemsChangeType: (value: SchemaChangeType | null) => void
  items: ReturnType<typeof useSchemaComparisonItems>

  // ── Selección compartida (Vistas 4a/5a) ──────────────────────────────────────
  allItems: ReturnType<typeof useAllSchemaComparisonItems>
  selectedItemIds: Set<number>
  reviewedItemIds: Set<number>
  toggleItemSelection: (id: number) => void
  applyShortcut: (shortcut: SelectionShortcut) => void
  markReviewed: (id: number) => void
  pendingReviewIds: number[]

  // ── Opción A (Vista 4b) ───────────────────────────────────────────────────────
  adoptName: string
  setAdoptName: (value: string) => void
  adoptDescription: string
  setAdoptDescription: (value: string) => void
  adoptExecuteImmediately: boolean
  setAdoptExecuteImmediately: (value: boolean) => void
  adopt: ReturnType<typeof useAdoptComparison>
  submitAdopt: () => void

  // ── Opción B (Vista 5b) ───────────────────────────────────────────────────────
  executeMode: ExecuteMode
  setExecuteMode: (mode: ExecuteMode) => void
  confirmTargetName: string
  setConfirmTargetName: (value: string) => void
  force: boolean
  setForce: (value: boolean) => void
  preview: ReturnType<typeof useExecutePreview>
  execute: ReturnType<typeof useExecuteComparison>
  submitExecute: () => void

  // ── Transversal ───────────────────────────────────────────────────────────────
  actionCooldown: boolean
  result: WizardResult | null
  recalculate: () => void
  reset: () => void
}

/**
 * Estado del selector agrupado en un único objeto (en vez de 5 `useState` independientes):
 * así, tanto los resets (`setFamily`/`setPickerServerId`/`setSelectionMode`) como el prellenado
 * desde `?targetDatabaseId=` actualizan todo lo que corresponde con UNA sola llamada a
 * `setState`, nunca varias sincrónicas dentro del mismo efecto/callback.
 */
interface SelectorState {
  mode: SelectionMode
  family: EngineFamily | null
  pickerServerId: number | null
  sourceSelection: DatabaseSideOption | null
  targetSelection: DatabaseSideOption | null
}

const INITIAL_SELECTOR_STATE: SelectorState = {
  mode: 'family',
  family: null,
  pickerServerId: null,
  sourceSelection: null,
  targetSelection: null,
}

export function useSchemaComparisonWizard(wizardOptions: WizardOptions = {}): SchemaComparisonWizard {
  const [step, setStep] = useState<WizardStep>('selector')

  const [selector, setSelector] = useState<SelectorState>(INITIAL_SELECTOR_STATE)
  const { mode: selectionMode, family, pickerServerId, sourceSelection, targetSelection } = selector

  const [comparisonId, setComparisonId] = useState<number | null>(null)

  const [itemsPage, setItemsPage] = useState(1)
  const [itemsSize, setItemsSizeState] = useState(20)
  const [itemsObjectType, setItemsObjectTypeState] = useState<SchemaObjectType | null>(null)
  const [itemsChangeType, setItemsChangeTypeState] = useState<SchemaChangeType | null>(null)

  const setItemsSize = useCallback((size: number) => {
    setItemsSizeState(size)
    setItemsPage(1)
  }, [])
  const setItemsObjectType = useCallback((value: SchemaObjectType | null) => {
    setItemsObjectTypeState(value)
    setItemsPage(1)
  }, [])
  const setItemsChangeType = useCallback((value: SchemaChangeType | null) => {
    setItemsChangeTypeState(value)
    setItemsPage(1)
  }, [])

  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set())
  const [reviewedItemIds, setReviewedItemIds] = useState<Set<number>>(new Set())

  const [adoptName, setAdoptName] = useState('')
  const [adoptDescription, setAdoptDescription] = useState('')
  const [adoptExecuteImmediately, setAdoptExecuteImmediately] = useState(false)

  const [executeMode, setExecuteMode] = useState<ExecuteMode>('all_except_destructive')
  const [confirmTargetName, setConfirmTargetName] = useState('')
  const [force, setForce] = useState(false)

  const [actionCooldown, setActionCooldown] = useState(false)
  const [result, setResult] = useState<WizardResult | null>(null)

  // ── Servidores (join para resolver el motor) ────────────────────────────────────
  const serverOptions = useServerOptions()
  const serverById = useMemo(() => {
    const map = new Map<number, ServerOut>()
    for (const server of serverOptions.data ?? []) map.set(server.id, server)
    return map
  }, [serverOptions.data])

  // ── Modo "por motor": BDs adoptadas del motor/familia elegida (comportamiento original) ──────
  const mysqlDbs = useManagedDatabaseOptions('mysql', selectionMode === 'family' && family === 'mysql_mariadb')
  const mariadbDbs = useManagedDatabaseOptions('mariadb', selectionMode === 'family' && family === 'mysql_mariadb')
  const postgresDbs = useManagedDatabaseOptions('postgresql', selectionMode === 'family' && family === 'postgresql')

  const familyLoading =
    family === 'postgresql' ? postgresDbs.isLoading : mysqlDbs.isLoading || mariadbDbs.isLoading
  const familyIsError = family === 'postgresql' ? postgresDbs.isError : mysqlDbs.isError || mariadbDbs.isError
  const familyError = family === 'postgresql' ? postgresDbs.error : (mysqlDbs.error ?? mariadbDbs.error)
  const refetchFamily = useCallback(() => {
    if (family === 'postgresql') void postgresDbs.refetch()
    else {
      void mysqlDbs.refetch()
      void mariadbDbs.refetch()
    }
  }, [family, postgresDbs, mysqlDbs, mariadbDbs])

  const familyModeOptions = useMemo<DatabaseSideOption[]>(() => {
    const raw = family === 'postgresql' ? (postgresDbs.data ?? []) : [...(mysqlDbs.data ?? []), ...(mariadbDbs.data ?? [])]
    const allowedEngines = family ? ENGINES_BY_FAMILY[family] : null
    return managedDatabasesToOptions(raw, serverById).filter((option) => {
      // Defensa en profundidad: si el backend ignorase el filtro `?engine=`, esto evita que una
      // BD de un motor incompatible se cuele en el selector solo porque la llamada la devolvió
      // igual. Motor aún sin resolver (servidores cargando) → no se oculta, se reevalúa después.
      if (!allowedEngines || !option.resolvedEngine) return true
      return allowedEngines.includes(option.resolvedEngine)
    })
  }, [family, postgresDbs.data, mysqlDbs.data, mariadbDbs.data, serverById])

  // ── Modo "por servidor": combina reconcile (vivas + estado) con el inventario de ese servidor ──
  const reconcile = useReconcile(pickerServerId ?? 0, selectionMode === 'server' && pickerServerId != null)
  const serverManagedDbs = useManagedDatabasesByServer(
    pickerServerId ?? 0,
    selectionMode === 'server' && pickerServerId != null,
  )
  const pickerServer = useMemo(
    () => (pickerServerId != null ? (serverById.get(pickerServerId) ?? null) : null),
    [pickerServerId, serverById],
  )
  const serverModeOptions = useMemo<DatabaseSideOption[]>(() => {
    if (!reconcile.data || pickerServerId == null) return []
    const modelIdByManagedId = new Map<number, number | null>()
    for (const db of serverManagedDbs.data ?? []) modelIdByManagedId.set(db.id, db.model_id ?? null)
    return reconcileItemsToOptions(
      reconcile.data.databases,
      pickerServerId,
      pickerServer?.engine,
      modelIdByManagedId,
    )
  }, [reconcile.data, serverManagedDbs.data, pickerServerId, pickerServer])

  const options = selectionMode === 'server' ? serverModeOptions : familyModeOptions
  const optionsLoading = selectionMode === 'server' ? reconcile.isLoading : familyLoading
  const optionsIsError = selectionMode === 'server' ? reconcile.isError : familyIsError
  const optionsError = selectionMode === 'server' ? reconcile.error : familyError
  const refetchOptions = useCallback(() => {
    if (selectionMode === 'server') void reconcile.refetch()
    else refetchFamily()
  }, [selectionMode, reconcile, refetchFamily])

  const sourceOptions = useMemo(
    () => options.filter((option) => option.key !== targetSelection?.key),
    [options, targetSelection],
  )
  const targetOptions = useMemo(
    () => options.filter((option) => option.key !== sourceSelection?.key),
    [options, sourceSelection],
  )

  // En modo "por servidor" ambos lados son SIEMPRE del mismo servidor → mismo motor siempre; el
  // aviso cross-flavor solo aplica al modo "por motor" (única forma de comparar servidores/
  // motores distintos, MySQL↔MariaDB).
  const crossFlavorWarning = useMemo(() => {
    if (selectionMode === 'server') return false
    return Boolean(
      sourceSelection?.resolvedEngine &&
        targetSelection?.resolvedEngine &&
        isCrossFlavorPair(sourceSelection.resolvedEngine, targetSelection.resolvedEngine),
    )
  }, [selectionMode, sourceSelection, targetSelection])

  const setSourceSelection = useCallback((next: DatabaseSideOption | null) => {
    setSelector((prev) => ({ ...prev, sourceSelection: next }))
  }, [])
  const setTargetSelection = useCallback((next: DatabaseSideOption | null) => {
    setSelector((prev) => ({ ...prev, targetSelection: next }))
  }, [])

  const setSelectionMode = useCallback((mode: SelectionMode) => {
    setSelector({
      mode,
      family: null,
      pickerServerId: null,
      sourceSelection: null,
      targetSelection: null,
    })
  }, [])
  const setFamily = useCallback((next: EngineFamily | null) => {
    setSelector((prev) => ({ ...prev, family: next, sourceSelection: null, targetSelection: null }))
  }, [])
  const setPickerServerId = useCallback((serverId: number | null) => {
    setSelector((prev) => ({
      ...prev,
      pickerServerId: serverId,
      sourceSelection: null,
      targetSelection: null,
    }))
  }, [])

  // ── Prellenado: si se llega con ?targetDatabaseId=, deriva motor + modo del target real ──────
  // Patrón "ajustar estado durante el render" (no un efecto): se compara contra el id ya
  // aplicado y, si cambió, se actualiza el estado ahí mismo — React re-renderiza antes de pintar,
  // sin el ciclo extra de un `useEffect` y sin el `setState` síncrono dentro de un efecto.
  const presetTargetId = wizardOptions.presetTargetId
  const presetTargetDetail = useManagedDatabase(presetTargetId ?? 0, presetTargetId != null)
  const [appliedPresetId, setAppliedPresetId] = useState<number | null>(null)
  if (
    presetTargetId != null &&
    presetTargetId !== appliedPresetId &&
    presetTargetDetail.data &&
    sourceSelection == null &&
    targetSelection == null
  ) {
    setAppliedPresetId(presetTargetId)
    const engine = resolveDatabaseEngine(presetTargetDetail.data, serverById)
    if (engine) {
      setSelector({
        mode: 'family',
        family: resolveEngineFamily(engine),
        pickerServerId: null,
        sourceSelection: null,
        targetSelection: {
          key: `managed:${presetTargetDetail.data.id}`,
          name: presetTargetDetail.data.name,
          serverId: presetTargetDetail.data.server_id,
          resolvedEngine: engine,
          managedId: presetTargetDetail.data.id,
          modelId: presetTargetDetail.data.model_id ?? null,
        },
      })
    }
  }

  // ── Creación de la comparación ────────────────────────────────────────────────
  const createComparisonState = useCreateSchemaComparison()

  const resetComparisonScopedState = useCallback(() => {
    setSelectedItemIds(new Set())
    setReviewedItemIds(new Set())
    setItemsPage(1)
    setItemsObjectType(null)
    setItemsChangeType(null)
    setAdoptName('')
    setAdoptDescription('')
    setAdoptExecuteImmediately(false)
    setExecuteMode('all_except_destructive')
    setConfirmTargetName('')
    setForce(false)
    setResult(null)
  }, [])

  // `createComparison` (Vista 1 → 2) y `recalculate` (tras un 410/409) son la MISMA operación:
  // crear una comparación nueva y limpiar todo el estado ligado a la comparación anterior. Se
  // unifican para que no puedan divergir — p. ej. que solo una de las dos limpie la selección de
  // ítems, dejando ids de una comparación vieja colándose en el body de un submit nuevo.
  const runComparisonCreate = useCallback(() => {
    if (!sourceSelection || !targetSelection) return
    const body = buildCreateComparisonBody(sourceSelection, targetSelection)
    createComparisonState.mutate(body, {
      onSuccess: (summaryOut) => {
        resetComparisonScopedState()
        setComparisonId(summaryOut.id)
        setStep('summary')
      },
    })
  }, [sourceSelection, targetSelection, createComparisonState, resetComparisonScopedState])

  const createComparison = runComparisonCreate
  const recalculate = runComparisonCreate

  const reset = useCallback(() => {
    setStep('selector')
    setSelector(INITIAL_SELECTOR_STATE)
    setComparisonId(null)
    resetComparisonScopedState()
    createComparisonState.reset()
  }, [resetComparisonScopedState, createComparisonState])

  const summary = useSchemaComparison(comparisonId ?? 0, comparisonId != null)

  // Identidad autoritativa del target: SIEMPRE se lee de la respuesta de la comparación (nunca
  // de la selección pre-submit), porque `target_database_id` puede venir `null` (BD cruda sin
  // registrar) o auto-resuelto a un id distinto del que se mandó (§ referencias crudas).
  const targetManagedId = summary.data?.target_database_id ?? null
  const targetDetail = useManagedDatabase(targetManagedId ?? 0, targetManagedId != null)

  const actionEntryStep = useMemo<'adoptSelect' | 'executeSelect' | null>(() => {
    if (!summary.data) return null
    // target sin inventario (BD cruda): nunca hay Opción A, no hace falta esperar nada más.
    if (targetManagedId == null) return 'executeSelect'
    if (!targetDetail.data) return null
    return targetDetail.data.model_id != null ? 'adoptSelect' : 'executeSelect'
  }, [summary.data, targetManagedId, targetDetail.data])

  // Motor/nombres: siempre desde la respuesta de la comparación (únicos campos garantizados para
  // ambos modos, adoptada o cruda — nunca desde el detalle en vivo, que no existe para una BD sin
  // registrar).
  const targetEngine = summary.data?.target_engine
  const sourceName = summary.data?.source_database_name ?? null
  const targetName = summary.data?.target_database_name ?? null

  // ── Vista 3: ítems paginados de solo lectura ─────────────────────────────────
  const itemsParams = useMemo(
    () => ({
      page: itemsPage,
      size: itemsSize,
      object_type: itemsObjectType ?? undefined,
      change_type: itemsChangeType ?? undefined,
    }),
    [itemsPage, itemsSize, itemsObjectType, itemsChangeType],
  )
  const items = useSchemaComparisonItems(comparisonId ?? 0, itemsParams, comparisonId != null)

  // ── Selección compartida (Vistas 4a/5a): fetch-all + Set independiente de la paginación ──────
  const selectionActive =
    step === 'adoptSelect' || step === 'adoptConfirm' || step === 'executeSelect' || step === 'executeConfirm'
  const allItems = useAllSchemaComparisonItems(comparisonId ?? 0, {}, comparisonId != null && selectionActive)

  const toggleItemSelection = useCallback((id: number) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const applyShortcut = useCallback(
    (shortcut: SelectionShortcut) => {
      setSelectedItemIds(resolveShortcutSelection(allItems.data?.items ?? [], shortcut, reviewedItemIds))
    },
    [allItems.data, reviewedItemIds],
  )
  const markReviewed = useCallback((id: number) => {
    setReviewedItemIds((prev) => new Set(prev).add(id))
  }, [])
  const pendingReviewIds = useMemo(
    () => pendingIndividualReviewIds(allItems.data?.items ?? [], selectedItemIds, reviewedItemIds),
    [allItems.data, selectedItemIds, reviewedItemIds],
  )

  // Referencia (no estado) porque solo se usa para cancelar/reprogramar el temporizador, nunca
  // para renderizar: si dos 429 llegan encimados, el segundo debe reemplazar el temporizador del
  // primero para no reactivar el botón antes de que el segundo rate-limit realmente expire.
  const cooldownTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const handleActionError = useCallback((error: unknown) => {
    if (toApiError(error).status === 429) {
      setActionCooldown(true)
      if (cooldownTimerRef.current != null) window.clearTimeout(cooldownTimerRef.current)
      cooldownTimerRef.current = window.setTimeout(() => {
        setActionCooldown(false)
        cooldownTimerRef.current = null
      }, 20_000)
    }
  }, [])
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current != null) window.clearTimeout(cooldownTimerRef.current)
    }
  }, [])

  // ── Opción A ──────────────────────────────────────────────────────────────────
  const adopt = useAdoptComparison(comparisonId ?? 0)
  const submitAdopt = useCallback(() => {
    const body = buildAdoptBody({
      selectedItemIds,
      name: adoptName,
      description: adoptDescription,
      executeImmediately: adoptExecuteImmediately,
    })
    adopt.mutate(body, {
      onSuccess: (data) => {
        setResult({ kind: 'adopt', data })
        setStep('result')
      },
      onError: handleActionError,
    })
  }, [selectedItemIds, adoptName, adoptDescription, adoptExecuteImmediately, handleActionError, adopt])

  // ── Opción B ──────────────────────────────────────────────────────────────────
  const previewActive = step === 'executeSelect' || step === 'executeConfirm'
  const preview = useExecutePreview(
    comparisonId ?? 0,
    executeMode,
    [...selectedItemIds],
    comparisonId != null && previewActive,
  )
  const execute = useExecuteComparison(comparisonId ?? 0)
  const submitExecute = useCallback(() => {
    if (!preview.data) return
    // Se construye el body a partir de `preview.data` (no del `executeMode`/`selectedItemIds` en
    // vivo): como `useExecutePreview` difiere (useDeferredValue) el mode/selección con el que
    // calcula el `confirm_token`, la selección en vivo puede ir un paso por delante de lo que el
    // token realmente certificó. Reenviar exactamente lo que el servidor ya validó (mismo mode,
    // mismos item_id de `statements[]`) elimina esa ventana de inconsistencia por construcción.
    const previewedMode = preview.data.mode as ExecuteMode
    const previewedItemIds = new Set(preview.data.statements.map((statement) => statement.item_id))
    const body = buildExecuteBody({
      mode: previewedMode,
      selectedItemIds: previewedMode === 'custom' ? previewedItemIds : selectedItemIds,
      confirmTargetName,
      confirmToken: preview.data.confirm_token,
    })
    execute.mutate(
      { body, force },
      {
        onSuccess: (data) => {
          setResult({ kind: 'execute', data })
          setStep('result')
        },
        onError: handleActionError,
      },
    )
  }, [preview.data, selectedItemIds, confirmTargetName, force, handleActionError, execute])

  // ── Navegación ────────────────────────────────────────────────────────────────
  const order = useMemo<WizardStep[]>(() => {
    const stepsInOrder: WizardStep[] = ['selector']
    if (comparisonId == null) return stepsInOrder
    stepsInOrder.push('summary')
    if (actionEntryStep === 'adoptSelect') stepsInOrder.push('adoptSelect', 'adoptConfirm')
    else if (actionEntryStep === 'executeSelect') stepsInOrder.push('executeSelect', 'executeConfirm')
    stepsInOrder.push('result')
    return stepsInOrder
  }, [comparisonId, actionEntryStep])

  const stageIndex = useMemo(() => {
    const stageKey = STAGE_KEY_BY_STEP[step]
    return WIZARD_STAGES.findIndex((s) => s.key === stageKey)
  }, [step])

  const next = useCallback(() => {
    setStep((current) => {
      const idx = order.indexOf(current)
      return idx >= 0 && idx < order.length - 1 ? order[idx + 1]! : current
    })
  }, [order])

  const back = useCallback(() => {
    if (step === 'items') {
      setStep('summary')
      return
    }
    setStep((current) => {
      const idx = order.indexOf(current)
      return idx > 0 ? order[idx - 1]! : current
    })
  }, [order, step])

  const goToStep = useCallback((target: WizardStep) => setStep(target), [])
  const canBack = step !== 'selector' && step !== 'result'

  return {
    step,
    order,
    stageIndex,
    canBack,
    next,
    back,
    goToStep,
    actionEntryStep,

    selectionMode,
    setSelectionMode,
    family,
    setFamily,
    serverOptions,
    pickerServerId,
    setPickerServerId,
    options,
    optionsLoading,
    optionsError: optionsIsError ? optionsError : null,
    refetchOptions,
    sourceSelection,
    targetSelection,
    setSourceSelection,
    setTargetSelection,
    sourceOptions,
    targetOptions,
    crossFlavorWarning,
    createComparison,
    createComparisonState,

    comparisonId,
    summary,
    targetDetail,
    targetEngine,
    sourceName,
    targetName,
    itemsPage,
    itemsSize,
    itemsObjectType,
    itemsChangeType,
    setItemsPage,
    setItemsSize,
    setItemsObjectType,
    setItemsChangeType,
    items,

    allItems,
    selectedItemIds,
    reviewedItemIds,
    toggleItemSelection,
    applyShortcut,
    markReviewed,
    pendingReviewIds,

    adoptName,
    setAdoptName,
    adoptDescription,
    setAdoptDescription,
    adoptExecuteImmediately,
    setAdoptExecuteImmediately,
    adopt,
    submitAdopt,

    executeMode,
    setExecuteMode,
    confirmTargetName,
    setConfirmTargetName,
    force,
    setForce,
    preview,
    execute,
    submitExecute,

    actionCooldown,
    result,
    recalculate,
    reset,
  }
}
