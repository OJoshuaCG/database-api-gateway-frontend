import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toApiError } from '@/lib/api/errors'
import {
  type AdoptComparisonOut,
  type ExecuteComparisonOut,
  type ExecuteMode,
  type ManagedDatabaseOut,
  type SchemaChangeType,
  type SchemaObjectType,
  type ServerOut,
} from '@/lib/contracts'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import {
  useManagedDatabase,
  useManagedDatabaseOptions,
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
  buildExecuteBody,
  ENGINES_BY_FAMILY,
  isCrossFlavorPair,
  resolveDatabaseEngine,
  resolveEngineFamily,
  resolveShortcutSelection,
  pendingIndividualReviewIds,
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

export type DatabaseOption = ManagedDatabaseOut & { resolvedEngine?: ManagedDatabaseOut['engine'] }

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
  family: EngineFamily | null
  setFamily: (family: EngineFamily | null) => void
  databases: DatabaseOption[]
  databasesLoading: boolean
  databasesError: unknown
  refetchDatabases: () => void
  sourceId: number | null
  targetId: number | null
  setSourceId: (id: number | null) => void
  setTargetId: (id: number | null) => void
  sourceDb: DatabaseOption | null
  targetDb: DatabaseOption | null
  sourceOptions: DatabaseOption[]
  targetOptions: DatabaseOption[]
  crossFlavorWarning: boolean
  createComparison: () => void
  createComparisonState: ReturnType<typeof useCreateSchemaComparison>

  // ── Comparación (Vistas 2/3) ─────────────────────────────────────────────────
  comparisonId: number | null
  summary: ReturnType<typeof useSchemaComparison>
  /** Verdad viva sobre el blueprint del target — determina la rama Opción A/B. */
  targetDetail: ReturnType<typeof useManagedDatabase>
  /** Motor real del target (detalle en vivo, con fallback al resuelto en el selector). */
  targetEngine: DatabaseOption['resolvedEngine']
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

export function useSchemaComparisonWizard(options: WizardOptions = {}): SchemaComparisonWizard {
  const [step, setStep] = useState<WizardStep>('selector')

  const [family, setFamilyState] = useState<EngineFamily | null>(null)
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [targetId, setTargetId] = useState<number | null>(options.presetTargetId ?? null)

  const [comparisonId, setComparisonId] = useState<number | null>(null)

  const [itemsPage, setItemsPage] = useState(1)
  const [itemsSize, setItemsSizeState] = useState(20)
  const [itemsObjectType, setItemsObjectTypeState] = useState<SchemaObjectType | null>(null)
  const [itemsChangeType, setItemsChangeTypeState] = useState<SchemaChangeType | null>(null)

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

  // ── Servidores (join para resolver el motor) + BDs por motor ────────────────────
  const serverOptions = useServerOptions()
  const serverById = useMemo(() => {
    const map = new Map<number, ServerOut>()
    for (const server of serverOptions.data ?? []) map.set(server.id, server)
    return map
  }, [serverOptions.data])

  const mysqlDbs = useManagedDatabaseOptions('mysql', family === 'mysql_mariadb')
  const mariadbDbs = useManagedDatabaseOptions('mariadb', family === 'mysql_mariadb')
  const postgresDbs = useManagedDatabaseOptions('postgresql', family === 'postgresql')

  const databasesLoading =
    family === 'postgresql' ? postgresDbs.isLoading : mysqlDbs.isLoading || mariadbDbs.isLoading
  const databasesIsError =
    family === 'postgresql' ? postgresDbs.isError : mysqlDbs.isError || mariadbDbs.isError
  const databasesError = family === 'postgresql' ? postgresDbs.error : (mysqlDbs.error ?? mariadbDbs.error)
  const refetchDatabases = useCallback(() => {
    if (family === 'postgresql') void postgresDbs.refetch()
    else {
      void mysqlDbs.refetch()
      void mariadbDbs.refetch()
    }
  }, [family, postgresDbs, mysqlDbs, mariadbDbs])

  const databases = useMemo<DatabaseOption[]>(() => {
    const raw = family === 'postgresql' ? (postgresDbs.data ?? []) : [...(mysqlDbs.data ?? []), ...(mariadbDbs.data ?? [])]
    const allowedEngines = family ? ENGINES_BY_FAMILY[family] : null
    return raw
      .map((db) => ({ ...db, resolvedEngine: resolveDatabaseEngine(db, serverById) }))
      .filter((db) => {
        // Defensa en profundidad: si el backend ignorase el filtro `?engine=` (no está firmado en
        // el contrato documentado hoy), esto evita que una BD de un motor incompatible se cuele
        // en el selector solo porque la llamada la devolvió igual. Si el motor real aún no se
        // pudo resolver (join con servidores todavía cargando), no se oculta — se reevalúa en
        // cuanto `serverById` se pueble.
        if (!allowedEngines || !db.resolvedEngine) return true
        return allowedEngines.includes(db.resolvedEngine)
      })
  }, [family, postgresDbs.data, mysqlDbs.data, mariadbDbs.data, serverById])

  const sourceDb = useMemo(() => databases.find((db) => db.id === sourceId) ?? null, [databases, sourceId])
  const targetDb = useMemo(() => databases.find((db) => db.id === targetId) ?? null, [databases, targetId])
  const sourceOptions = useMemo(() => databases.filter((db) => db.id !== targetId), [databases, targetId])
  const targetOptions = useMemo(() => databases.filter((db) => db.id !== sourceId), [databases, sourceId])

  const crossFlavorWarning = Boolean(
    sourceDb?.resolvedEngine &&
      targetDb?.resolvedEngine &&
      isCrossFlavorPair(sourceDb.resolvedEngine, targetDb.resolvedEngine),
  )

  const setFamily = useCallback((next: EngineFamily | null) => {
    setFamilyState(next)
    setSourceId(null)
    setTargetId(null)
  }, [])

  // ── model_id del target: SIEMPRE se resuelve en vivo (nunca congelado del selector) ─────────
  const targetDetail = useManagedDatabase(targetId ?? 0, targetId != null)

  // Prellenado: si se llega con ?targetDatabaseId=, deriva la familia del motor real del target.
  useEffect(() => {
    if (family == null && targetDetail.data) {
      const engine = resolveDatabaseEngine(targetDetail.data, serverById)
      if (engine) setFamilyState(resolveEngineFamily(engine))
    }
  }, [family, targetDetail.data, serverById])

  const actionEntryStep = useMemo<'adoptSelect' | 'executeSelect' | null>(() => {
    if (!targetDetail.data) return null
    return targetDetail.data.model_id != null ? 'adoptSelect' : 'executeSelect'
  }, [targetDetail.data])

  // Motor del target: prioriza el detalle en vivo sobre el resuelto en el selector, para que la
  // limitación de procedurales MySQL/MariaDB (Opción A) y demás avisos usen siempre el motor real
  // más reciente. Un único cómputo aquí evita que los pasos lo re-deriven cada uno por su cuenta.
  const targetEngine = targetDetail.data?.engine ?? targetDb?.resolvedEngine

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
    if (sourceId == null || targetId == null) return
    createComparisonState.mutate(
      { source_database_id: sourceId, target_database_id: targetId },
      {
        onSuccess: (summary) => {
          resetComparisonScopedState()
          setComparisonId(summary.id)
          setStep('summary')
        },
      },
    )
  }, [sourceId, targetId, createComparisonState, resetComparisonScopedState])

  const createComparison = runComparisonCreate
  const recalculate = runComparisonCreate

  const reset = useCallback(() => {
    setStep('selector')
    setFamilyState(null)
    setSourceId(null)
    setTargetId(null)
    setComparisonId(null)
    resetComparisonScopedState()
    createComparisonState.reset()
  }, [resetComparisonScopedState, createComparisonState])

  const summary = useSchemaComparison(comparisonId ?? 0, comparisonId != null)

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

    family,
    setFamily,
    databases,
    databasesLoading,
    databasesError: databasesIsError ? databasesError : null,
    refetchDatabases,
    sourceId,
    targetId,
    setSourceId,
    setTargetId,
    sourceDb,
    targetDb,
    sourceOptions,
    targetOptions,
    crossFlavorWarning,
    createComparison,
    createComparisonState,

    comparisonId,
    summary,
    targetDetail,
    targetEngine,
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
