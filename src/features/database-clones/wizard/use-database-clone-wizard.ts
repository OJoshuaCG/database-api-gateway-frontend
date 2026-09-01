import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import type {
  CloneCleanMode,
  CloneObjectOut,
  CloneObjectRef,
  CloneObjectType,
  CloneTargetMode,
  ServerOut,
} from '@/lib/contracts'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useReconcile } from '@/features/servers/hooks/use-reconcile'
import {
  useManagedDatabase,
  useManagedDatabaseOptions,
  useManagedDatabasesByServer,
} from '@/features/managed-databases/hooks/use-managed-databases'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import {
  CLONE_TERMINAL_STATUSES,
  useCloneItems,
  useCloneObjects,
  useCloneResolveSelection,
  useClonePreview,
  useDatabaseClone,
} from '../hooks/use-database-clones'
import {
  useCancelDatabaseClone,
  useCreateDatabaseClone,
  useExecuteDatabaseClone,
} from '../hooks/use-database-clone-actions'
import {
  INITIAL_PLAN_FORM,
  INITIAL_RULE_SELECTION,
  applyBulkSelection,
  buildCreateCloneBody,
  buildExecuteBody,
  buildStructureSpec,
  canAdoptTarget,
  countSelectableObjects,
  countSelectedObjects,
  managedDatabasesToSourceOptions,
  reconcileItemsToSourceOptions,
  reconcileItemsToTargetOptions,
  resolveDatabaseEngine,
  resolveRuleSelection,
  ruleSelectsEverything,
  toggleCloneObjectSelection,
  type BulkSelectionAction,
  type CloneSelectionKind,
  type CloneSelectionPlan,
  type CloneSourceOption,
  type PlanFormState,
  type RuleSelectionState,
} from './logic'

export type WizardStep = 'summary' | 'plan' | 'selection' | 'preview' | 'monitor'
export type PlanMode = 'complete' | 'partial'
export type SourceMode = 'inventory' | 'server'

interface WizardOptions {
  /** Reentrada desde un link directo a un job existente (`?jobId=`). */
  presetJobId?: number
  /** Prellenado desde la fila "Clonar" de una BD gestionada (`?sourceDatabaseId=`). */
  presetSourceDatabaseId?: number
}

interface PlanState extends PlanFormState {
  sourceMode: SourceMode
  /** Servidor elegido en modo "por servidor" — solo para poblar el picker de origen. */
  sourceServerId: number | null
  planMode: PlanMode
}

const INITIAL_PLAN_STATE: PlanState = {
  ...INITIAL_PLAN_FORM,
  sourceMode: 'inventory',
  sourceServerId: null,
  planMode: 'complete',
}

// Constante de módulo, no un literal creado en cada render: `useClonePreview` la pasa por
// `useDeferredValue`, y un objeto nuevo por render nunca terminaría de "asentarse".
const FULL_SELECTION: CloneSelectionPlan = { kind: 'full' }

export interface DatabaseCloneWizard {
  // ── Navegación ──────────────────────────────────────────────────────────────
  step: WizardStep
  order: WizardStep[]
  canBack: boolean
  next: () => void
  back: () => void
  goToStep: (step: WizardStep) => void

  // ── Vista 1: plan ─────────────────────────────────────────────────────────────
  plan: PlanState
  setSourceMode: (mode: SourceMode) => void
  setSourceServerId: (serverId: number | null) => void
  setSource: (option: CloneSourceOption | null) => void
  setTargetServerId: (serverId: number | null) => void
  setTargetMode: (mode: CloneTargetMode) => void
  setTargetDatabaseName: (name: string) => void
  setTargetExisting: (option: CloneSourceOption | null) => void
  setIncludeData: (value: boolean) => void
  setCleanMode: (mode: CloneCleanMode) => void
  setPlanMode: (mode: PlanMode) => void
  setAdoptTarget: (value: boolean) => void
  setAdoptOwnerId: (id: number | null) => void

  serverOptions: ReturnType<typeof useServerOptions>
  sourceInventoryOptions: ReturnType<typeof useManagedDatabaseOptions>
  sourceServerReconcile: ReturnType<typeof useReconcile>
  sourceOptions: CloneSourceOption[]
  sourceOptionsLoading: boolean
  sourceOptionsError: unknown
  targetExistingReconcile: ReturnType<typeof useReconcile>
  targetExistingOptions: CloneSourceOption[]
  targetExistingLoading: boolean
  targetExistingError: unknown
  ownerOptions: ReturnType<typeof useServerUserOptions>
  canAdoptTarget: boolean

  createClone: ReturnType<typeof useCreateDatabaseClone>
  createPlanDisabled: boolean
  createPlan: () => void

  // ── Job ───────────────────────────────────────────────────────────────────────
  jobId: number | null
  job: ReturnType<typeof useDatabaseClone>
  /** Detalle en vivo del destino gestionado (para saber si está en cuarentena, `status=error`). */
  targetManagedDetail: ReturnType<typeof useManagedDatabase>

  // ── Vista 3: selección de objetos ─────────────────────────────────────────────
  objects: ReturnType<typeof useCloneObjects>
  /** Idioma de la selección: marcar a mano o describirla con una regla. Excluyentes por contrato. */
  selectionKind: CloneSelectionKind
  setSelectionKind: (kind: CloneSelectionKind) => void
  /** Tipos de objeto realmente presentes en el inventario del origen. */
  availableTypes: CloneObjectType[]
  /** `true` si la selección actual no clonaría nada (bloquea el avance). */
  selectionEmpty: boolean

  // Modo manual
  checkedSelection: Map<string, CloneObjectRef>
  toggleObject: (ref: CloneObjectRef) => void
  manualTypeFilter: CloneObjectType[]
  toggleManualTypeFilter: (type: CloneObjectType) => void
  /** Objetos visibles según el filtro por tipo; es sobre estos que actúa `bulkSelect`. */
  visibleObjects: CloneObjectOut[]
  visibleSelectableCount: number
  visibleSelectedCount: number
  bulkSelect: (action: BulkSelectionAction) => void
  closure: ReturnType<typeof useCloneResolveSelection>

  // Modo regla
  rule: RuleSelectionState
  ruleSpec: ReturnType<typeof buildStructureSpec>
  /** Coincidencias calculadas en el cliente: orientativas, no el plan real. */
  ruleMatches: CloneObjectOut[]
  ruleMatchesEverything: boolean
  setRuleTypes: (types: CloneObjectType[]) => void
  toggleRuleType: (type: CloneObjectType) => void
  setRuleIncludePatterns: (value: string) => void
  setRuleExcludePatterns: (value: string) => void

  confirmSelection: () => void

  // ── Vista 4: preview + confirmación ───────────────────────────────────────────
  finalSelectionPlan: CloneSelectionPlan
  preview: ReturnType<typeof useClonePreview>
  confirmTargetName: string
  setConfirmTargetName: (value: string) => void
  force: boolean
  setForce: (value: boolean) => void
  execute: ReturnType<typeof useExecuteDatabaseClone>
  submitExecute: () => void

  // ── Vista 6: monitor ───────────────────────────────────────────────────────────
  itemsPage: number
  itemsSize: number
  setItemsPage: (page: number) => void
  items: ReturnType<typeof useCloneItems>
  cancel: ReturnType<typeof useCancelDatabaseClone>
  cancelClone: () => void

  // ── Transversal ───────────────────────────────────────────────────────────────
  actionCooldown: boolean
  replan: () => void
  reset: () => void
}

export function useDatabaseCloneWizard(wizardOptions: WizardOptions = {}): DatabaseCloneWizard {
  const presetJobId = wizardOptions.presetJobId
  const queryClient = useQueryClient()

  const [step, setStep] = useState<WizardStep>(presetJobId != null ? 'summary' : 'plan')
  const [jobId, setJobId] = useState<number | null>(presetJobId ?? null)
  const [plan, setPlan] = useState<PlanState>(INITIAL_PLAN_STATE)

  const [checkedSelection, setCheckedSelection] = useState<Map<string, CloneObjectRef>>(new Map())
  const [selectionKind, setSelectionKind] = useState<CloneSelectionKind>('manual')
  const [rule, setRule] = useState<RuleSelectionState>(INITIAL_RULE_SELECTION)
  const [manualTypeFilter, setManualTypeFilter] = useState<CloneObjectType[]>([])
  const [finalSelectionPlan, setFinalSelectionPlan] = useState<CloneSelectionPlan>(FULL_SELECTION)
  const [confirmTargetName, setConfirmTargetName] = useState('')
  const [force, setForce] = useState(false)
  const [itemsPage, setItemsPageState] = useState(1)
  const itemsSize = 20
  const setItemsPage = useCallback((page: number) => setItemsPageState(page), [])

  const [actionCooldown, setActionCooldown] = useState(false)
  // Referencia (no estado): solo se usa para cancelar/reprogramar el temporizador del cooldown de
  // 429, nunca para renderizar. Declarado temprano porque `resetJobScopedState` (más abajo)
  // necesita poder cancelarlo al arrancar un job nuevo.
  const cooldownTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  // ── Servidores ────────────────────────────────────────────────────────────────
  const serverOptions = useServerOptions()
  const serverById = useMemo(() => {
    const map = new Map<number, ServerOut>()
    for (const server of serverOptions.data ?? []) map.set(server.id, server)
    return map
  }, [serverOptions.data])

  // ── Prellenado: `?sourceDatabaseId=` (fila "Clonar" de una BD gestionada) ─────────
  // Patrón "ajustar estado durante el render" (no un efecto): se compara contra el id ya
  // aplicado y, si cambió, se actualiza el estado ahí mismo — evita el ciclo extra de un
  // `useEffect` y el `setState` síncrono dentro de un efecto (ver `use-schema-comparison-wizard`).
  const presetSourceDatabaseId = wizardOptions.presetSourceDatabaseId
  const presetSourceDetail = useManagedDatabase(presetSourceDatabaseId ?? 0, presetSourceDatabaseId != null)
  const [appliedPresetSourceId, setAppliedPresetSourceId] = useState<number | null>(null)
  if (
    presetSourceDatabaseId != null &&
    presetSourceDatabaseId !== appliedPresetSourceId &&
    presetSourceDetail.data &&
    plan.source == null
  ) {
    setAppliedPresetSourceId(presetSourceDatabaseId)
    setPlan((prev) => ({
      ...prev,
      sourceMode: 'inventory',
      source: {
        key: `managed:${presetSourceDetail.data.id}`,
        name: presetSourceDetail.data.name,
        serverId: presetSourceDetail.data.server_id,
        resolvedEngine: resolveDatabaseEngine(presetSourceDetail.data, serverById),
        managedId: presetSourceDetail.data.id,
        modelId: presetSourceDetail.data.model_id ?? null,
      },
    }))
  }

  // ── Origen: modo "inventario" (todas las BDs gestionadas) ─────────────────────
  const sourceInventoryOptions = useManagedDatabaseOptions(undefined, plan.sourceMode === 'inventory')
  const inventorySourceOptions = useMemo(
    () => managedDatabasesToSourceOptions(sourceInventoryOptions.data ?? [], serverById),
    [sourceInventoryOptions.data, serverById],
  )

  // ── Origen: modo "servidor" (BDs vivas del servidor elegido, adoptadas o no) ───
  const sourceServerReconcile = useReconcile(
    plan.sourceServerId ?? 0,
    plan.sourceMode === 'server' && plan.sourceServerId != null,
  )
  const sourceServerManagedDbs = useManagedDatabasesByServer(
    plan.sourceServerId ?? 0,
    plan.sourceMode === 'server' && plan.sourceServerId != null,
  )
  const sourceServerOptions = useMemo(() => {
    if (!sourceServerReconcile.data || plan.sourceServerId == null) return []
    const modelIdByManagedId = new Map<number, number | null>()
    for (const db of sourceServerManagedDbs.data ?? []) modelIdByManagedId.set(db.id, db.model_id ?? null)
    const server = serverById.get(plan.sourceServerId)
    return reconcileItemsToSourceOptions(
      sourceServerReconcile.data.databases,
      plan.sourceServerId,
      server?.engine,
      modelIdByManagedId,
    )
  }, [sourceServerReconcile.data, sourceServerManagedDbs.data, plan.sourceServerId, serverById])

  const sourceOptions = plan.sourceMode === 'server' ? sourceServerOptions : inventorySourceOptions
  const sourceOptionsLoading =
    plan.sourceMode === 'server' ? sourceServerReconcile.isLoading : sourceInventoryOptions.isLoading
  const sourceOptionsError =
    plan.sourceMode === 'server'
      ? sourceServerReconcile.isError
        ? sourceServerReconcile.error
        : null
      : sourceInventoryOptions.isError
        ? sourceInventoryOptions.error
        : null

  // ── Destino existente: BDs vivas del servidor destino ─────────────────────────
  const targetExistingReconcile = useReconcile(
    plan.targetServerId ?? 0,
    plan.targetMode === 'existing' && plan.targetServerId != null,
  )
  const targetServerManagedDbs = useManagedDatabasesByServer(
    plan.targetServerId ?? 0,
    plan.targetMode === 'existing' && plan.targetServerId != null,
  )
  const targetExistingOptions = useMemo(() => {
    if (!targetExistingReconcile.data || plan.targetServerId == null) return []
    const modelIdByManagedId = new Map<number, number | null>()
    for (const db of targetServerManagedDbs.data ?? []) modelIdByManagedId.set(db.id, db.model_id ?? null)
    const server = serverById.get(plan.targetServerId)
    return reconcileItemsToTargetOptions(
      targetExistingReconcile.data.databases,
      plan.targetServerId,
      server?.engine,
      modelIdByManagedId,
    )
  }, [targetExistingReconcile.data, targetServerManagedDbs.data, plan.targetServerId, serverById])

  const ownerOptions = useServerUserOptions(plan.targetServerId)

  // ── Setters del plan (agrupados en un solo objeto, resets atómicos) ───────────
  const setSourceMode = useCallback((mode: SourceMode) => {
    setPlan((prev) => ({ ...prev, sourceMode: mode, sourceServerId: null, source: null }))
  }, [])
  const setSourceServerId = useCallback((serverId: number | null) => {
    setPlan((prev) => ({ ...prev, sourceServerId: serverId, source: null }))
  }, [])
  const setSource = useCallback((option: CloneSourceOption | null) => {
    setPlan((prev) => ({ ...prev, source: option }))
  }, [])
  const setTargetServerId = useCallback((serverId: number | null) => {
    setPlan((prev) => ({ ...prev, targetServerId: serverId, targetExisting: null }))
  }, [])
  const setTargetMode = useCallback((mode: CloneTargetMode) => {
    setPlan((prev) => ({ ...prev, targetMode: mode, targetExisting: null, cleanMode: 'none' }))
  }, [])
  const setTargetDatabaseName = useCallback((name: string) => {
    setPlan((prev) => ({ ...prev, targetDatabaseName: name }))
  }, [])
  const setTargetExisting = useCallback((option: CloneSourceOption | null) => {
    setPlan((prev) => ({ ...prev, targetExisting: option }))
  }, [])
  const setIncludeData = useCallback((value: boolean) => {
    setPlan((prev) => ({ ...prev, includeData: value }))
  }, [])
  const setCleanMode = useCallback((mode: CloneCleanMode) => {
    setPlan((prev) => ({ ...prev, cleanMode: mode }))
  }, [])
  const setPlanMode = useCallback((mode: PlanMode) => {
    setPlan((prev) => ({ ...prev, planMode: mode, adoptTarget: mode === 'complete' ? prev.adoptTarget : false }))
  }, [])
  const setAdoptTarget = useCallback((value: boolean) => {
    setPlan((prev) => ({ ...prev, adoptTarget: value }))
  }, [])
  const setAdoptOwnerId = useCallback((id: number | null) => {
    setPlan((prev) => ({ ...prev, adoptOwnerId: id }))
  }, [])

  const canAdopt = canAdoptTarget(plan, plan.planMode)

  // ── Mutaciones ligadas al job actual (declaradas temprano: `resetJobScopedState` necesita
  // poder resetear su error/data al arrancar un job nuevo) ──────────────────────────
  const createClone = useCreateDatabaseClone()
  const execute = useExecuteDatabaseClone(jobId ?? 0)
  const cancel = useCancelDatabaseClone(jobId ?? 0)

  const createBody = useMemo(() => buildCreateCloneBody(plan), [plan])
  const createPlanDisabled = createBody == null || createClone.isPending

  // Limpia TODO el estado ligado a un job (selección, confirmación, paginación, cooldown de rate
  // limit y el resultado de mutaciones previas) — se llama tanto al crear un plan nuevo como en
  // `reset()`. Unificado en un solo lugar para que ningún caller pueda olvidar una pieza: antes de
  // esto, un 429/410 de un job viejo podía sobrevivir (cooldown activo, o el `error` de `execute`
  // renderizándose falsamente en el preview de un job recién creado) al saltar a uno nuevo.
  const resetJobScopedState = useCallback(() => {
    setCheckedSelection(new Map())
    setSelectionKind('manual')
    setRule(INITIAL_RULE_SELECTION)
    setManualTypeFilter([])
    setFinalSelectionPlan(FULL_SELECTION)
    setConfirmTargetName('')
    setForce(false)
    setItemsPageState(1)
    setActionCooldown(false)
    if (cooldownTimerRef.current != null) {
      window.clearTimeout(cooldownTimerRef.current)
      cooldownTimerRef.current = null
    }
    execute.reset()
    cancel.reset()
  }, [execute, cancel])

  const createPlan = useCallback(() => {
    if (!createBody) return
    createClone.mutate(createBody, {
      onSuccess: (summary) => {
        // `resetJobScopedState` ya deja el plan de selección en "clon completo", que es lo
        // correcto para `planMode === 'complete'`; el parcial lo define `confirmSelection`.
        resetJobScopedState()
        setJobId(summary.id)
        setStep(plan.planMode === 'partial' ? 'selection' : 'preview')
      },
    })
  }, [createBody, createClone, plan.planMode, resetJobScopedState])

  // ── Job (resumen + estado, polling) ────────────────────────────────────────────
  const job = useDatabaseClone(jobId ?? 0, jobId != null)
  const targetManagedDetail = useManagedDatabase(
    job.data?.target_database_id ?? 0,
    job.data?.target_database_id != null,
  )
  const sourceManagedDetail = useManagedDatabase(
    job.data?.source_database_id ?? 0,
    job.data?.source_database_id != null,
  )

  useEffect(() => {
    if (job.data?.status === 'succeeded') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
    }
  }, [job.data?.status, queryClient])

  // ── Prellenado del formulario del plan a partir de un job ya existente ───────────
  // Cubre la reentrada (`?jobId=`) y el CTA "Replanear" tras un job terminado: sin esto, el
  // paso "plan" se vería vacío y el usuario tendría que rearmar todo el formulario desde cero.
  // Mismo patrón "ajustar estado durante el render" que el prellenado de `?sourceDatabaseId=`.
  const [appliedPlanFromJobId, setAppliedPlanFromJobId] = useState<number | null>(null)
  if (jobId != null && jobId !== appliedPlanFromJobId && job.data && plan.source == null) {
    const summary = job.data
    const sourceIsManaged = summary.source_database_id != null
    if (!sourceIsManaged || sourceManagedDetail.data) {
      setAppliedPlanFromJobId(jobId)
      setPlan((prev) => ({
        ...prev,
        sourceMode: sourceIsManaged ? 'inventory' : 'server',
        sourceServerId: sourceIsManaged ? null : summary.source_server_id,
        source: {
          key: sourceIsManaged
            ? `managed:${summary.source_database_id}`
            : `raw:${summary.source_server_id}:${summary.source_database_name}`,
          name: summary.source_database_name,
          serverId: summary.source_server_id,
          resolvedEngine: summary.source_engine,
          managedId: summary.source_database_id,
          modelId: sourceManagedDetail.data?.model_id ?? null,
        },
        targetServerId: summary.target_server_id,
        targetMode: summary.target_mode,
        targetDatabaseName: summary.target_database_name,
        targetExisting:
          summary.target_mode === 'existing'
            ? {
                key:
                  summary.target_database_id != null
                    ? `managed:${summary.target_database_id}`
                    : `raw:${summary.target_server_id}:${summary.target_database_name}`,
                name: summary.target_database_name,
                serverId: summary.target_server_id,
                resolvedEngine: summary.target_engine,
                managedId: summary.target_database_id,
                modelId: null,
              }
            : null,
        includeData: summary.include_data,
        cleanMode: summary.clean_mode,
        adoptTarget: false,
        adoptOwnerId: null,
        // El resumen del job no distingue "clon completo" de "parcial vacío" (`selection` no
        // viaja en `CloneSummaryOut`) — se asume completo, que es el default y lo que corresponde
        // a la gran mayoría de jobs; el usuario puede cambiarlo a "parcial" antes de replanear.
        planMode: 'complete',
      }))
    }
  }

  // ── Vista 3: selección de objetos ──────────────────────────────────────────────
  const objects = useCloneObjects(jobId ?? 0, jobId != null && step === 'selection')
  const allObjects = useMemo<CloneObjectOut[]>(() => objects.data?.objects ?? [], [objects.data])

  // Tipos presentes en el inventario, para no ofrecer un filtro de un tipo que no existe acá.
  const availableTypes = useMemo<CloneObjectType[]>(() => {
    const seen = new Set<CloneObjectType>()
    for (const object of allObjects) seen.add(object.object_type)
    return [...seen]
  }, [allObjects])

  // Lista visible del modo manual. Las acciones masivas operan sobre ESTO, no sobre el
  // inventario entero: con un filtro activo, «Todo» agrega lo visible y respeta lo ya marcado
  // en los tipos ocultos (`applyBulkSelection` parte de la selección actual).
  const visibleObjects = useMemo(() => {
    if (manualTypeFilter.length === 0) return allObjects
    const wanted = new Set(manualTypeFilter)
    return allObjects.filter((object) => wanted.has(object.object_type))
  }, [allObjects, manualTypeFilter])

  const toggleObject = useCallback((ref: CloneObjectRef) => {
    setCheckedSelection((prev) => toggleCloneObjectSelection(prev, ref))
  }, [])
  const bulkSelect = useCallback(
    (action: BulkSelectionAction) => {
      setCheckedSelection((prev) => applyBulkSelection(action, visibleObjects, prev))
    },
    [visibleObjects],
  )
  const toggleManualTypeFilter = useCallback((type: CloneObjectType) => {
    setManualTypeFilter((prev) =>
      prev.includes(type) ? prev.filter((value) => value !== type) : [...prev, type],
    )
  }, [])

  const visibleSelectableCount = useMemo(
    () => countSelectableObjects(visibleObjects),
    [visibleObjects],
  )
  const visibleSelectedCount = useMemo(
    () => countSelectedObjects(visibleObjects, checkedSelection),
    [visibleObjects, checkedSelection],
  )

  // ── Modo `rule`: spec declarativo + conteo orientativo ──────────────────────────
  const ruleSpec = useMemo(() => buildStructureSpec(rule), [rule])
  const ruleMatches = useMemo(
    () => (selectionKind === 'rule' ? resolveRuleSelection(allObjects, ruleSpec) : []),
    [selectionKind, allObjects, ruleSpec],
  )
  const ruleMatchesEverything = ruleSelectsEverything(ruleSpec)
  const setRuleTypes = useCallback((types: CloneObjectType[]) => {
    setRule((prev) => ({ ...prev, types }))
  }, [])
  const toggleRuleType = useCallback((type: CloneObjectType) => {
    setRule((prev) => ({
      ...prev,
      types: prev.types.includes(type)
        ? prev.types.filter((value) => value !== type)
        : [...prev.types, type],
    }))
  }, [])
  const setRuleIncludePatterns = useCallback((value: string) => {
    setRule((prev) => ({ ...prev, includePatterns: value }))
  }, [])
  const setRuleExcludePatterns = useCallback((value: string) => {
    setRule((prev) => ({ ...prev, excludePatterns: value }))
  }, [])

  const checkedList = useMemo(() => [...checkedSelection.values()], [checkedSelection])
  // El cierre de dependencias es del modo manual: en el modo declarativo lo resuelve el backend
  // al congelar el plan en `preview`, así que pedirlo acá sería gastar una llamada (10/min) para
  // mostrar un cierre de una selección que no es la que se va a enviar.
  const closure = useCloneResolveSelection(
    jobId ?? 0,
    checkedList,
    jobId != null && step === 'selection' && selectionKind === 'manual' && checkedList.length > 0,
  )

  /** `true` si la selección actual no permite avanzar (no hay nada que clonar). */
  const selectionEmpty =
    selectionKind === 'manual' ? checkedList.length === 0 : ruleMatches.length === 0

  const confirmSelection = useCallback(() => {
    if (selectionKind === 'rule') {
      setFinalSelectionPlan({ kind: 'rule', structure: ruleSpec })
      setStep('preview')
      return
    }
    // Bloqueo por construcción: mientras `closure.isStale` sea `true`, `closure.data` todavía
    // describe una selección ANTERIOR a la que el usuario tiene marcada ahora mismo (la
    // transición diferida de `useCloneResolveSelection` no alcanzó a recomputar) — confirmar en
    // ese instante silenciosamente excluiría del clon lo que el usuario acaba de marcar.
    if (closure.isStale) return
    setFinalSelectionPlan({ kind: 'manual', refs: closure.data?.closure ?? checkedList })
    setStep('preview')
  }, [selectionKind, ruleSpec, closure.data, closure.isStale, checkedList])

  // ── Vista 4: preview + confirmación ────────────────────────────────────────────
  const preview = useClonePreview(jobId ?? 0, finalSelectionPlan, jobId != null && step === 'preview')

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

  const submitExecute = useCallback(() => {
    if (!preview.data) return
    const body = buildExecuteBody({
      confirmTargetName,
      confirmToken: preview.data.confirm_token,
      force,
    })
    execute.mutate(body, {
      onSuccess: () => setStep('monitor'),
      onError: handleActionError,
    })
  }, [preview.data, confirmTargetName, force, execute, handleActionError])

  // ── Vista 6: monitor ────────────────────────────────────────────────────────────
  const itemsParams = useMemo(() => ({ page: itemsPage, size: itemsSize }), [itemsPage])
  const itemsPolling = job.data != null && !CLONE_TERMINAL_STATUSES.has(job.data.status)
  const items = useCloneItems(jobId ?? 0, itemsParams, jobId != null && step === 'monitor', itemsPolling)
  const cancelClone = useCallback(() => {
    cancel.mutate()
  }, [cancel])

  // ── Navegación ────────────────────────────────────────────────────────────────────
  // `selection` solo forma parte del recorrido real de un clon PARCIAL: incluirla siempre haría
  // que el indicador de pasos (`WizardStepper`) la marcara como "ya completada" y navegable para
  // un clon COMPLETO que nunca pasó por ahí — permitiendo saltar a Vista 3 y sobrescribir
  // `finalSelectionPlan` (que debía quedar en `kind: 'full'`) con una selección parcial no pedida.
  const order = useMemo<WizardStep[]>(() => {
    const steps: WizardStep[] = []
    if (presetJobId != null) steps.push('summary')
    steps.push('plan')
    if (plan.planMode === 'partial') steps.push('selection')
    steps.push('preview', 'monitor')
    return steps
  }, [presetJobId, plan.planMode])

  const next = useCallback(() => {
    setStep((current) => {
      const idx = order.indexOf(current)
      return idx >= 0 && idx < order.length - 1 ? order[idx + 1]! : current
    })
  }, [order])
  const back = useCallback(() => {
    setStep((current) => {
      const idx = order.indexOf(current)
      return idx > 0 ? order[idx - 1]! : current
    })
  }, [order])
  const goToStep = useCallback((target: WizardStep) => setStep(target), [])
  const canBack = order.indexOf(step) > 0 && step !== 'monitor'

  const reset = useCallback(() => {
    setStep(presetJobId != null ? 'summary' : 'plan')
    setJobId(presetJobId ?? null)
    setPlan(INITIAL_PLAN_STATE)
    resetJobScopedState()
    createClone.reset()
  }, [presetJobId, resetJobScopedState, createClone])

  const replan = useCallback(() => {
    setStep('plan')
  }, [])

  return {
    step,
    order,
    canBack,
    next,
    back,
    goToStep,

    plan,
    setSourceMode,
    setSourceServerId,
    setSource,
    setTargetServerId,
    setTargetMode,
    setTargetDatabaseName,
    setTargetExisting,
    setIncludeData,
    setCleanMode,
    setPlanMode,
    setAdoptTarget,
    setAdoptOwnerId,

    serverOptions,
    sourceInventoryOptions,
    sourceServerReconcile,
    sourceOptions,
    sourceOptionsLoading,
    sourceOptionsError,
    targetExistingReconcile,
    targetExistingOptions,
    targetExistingLoading: targetExistingReconcile.isLoading,
    targetExistingError: targetExistingReconcile.isError ? targetExistingReconcile.error : null,
    ownerOptions,
    canAdoptTarget: canAdopt,

    createClone,
    createPlanDisabled,
    createPlan,

    jobId,
    job,
    targetManagedDetail,

    objects,
    selectionKind,
    setSelectionKind,
    availableTypes,
    selectionEmpty,

    checkedSelection,
    toggleObject,
    manualTypeFilter,
    toggleManualTypeFilter,
    visibleObjects,
    visibleSelectableCount,
    visibleSelectedCount,
    bulkSelect,
    closure,

    rule,
    ruleSpec,
    ruleMatches,
    ruleMatchesEverything,
    setRuleTypes,
    toggleRuleType,
    setRuleIncludePatterns,
    setRuleExcludePatterns,

    confirmSelection,

    finalSelectionPlan,
    preview,
    confirmTargetName,
    setConfirmTargetName,
    force,
    setForce,
    execute,
    submitExecute,

    itemsPage,
    itemsSize,
    setItemsPage,
    items,
    cancel,
    cancelClone,

    actionCooldown,
    replan,
    reset,
  }
}
