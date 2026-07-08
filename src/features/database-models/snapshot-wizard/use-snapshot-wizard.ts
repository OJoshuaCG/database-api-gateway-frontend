import { useCallback, useMemo, useState } from 'react'
import {
  SLUG_PATTERN,
  type DataSeedMode,
  type DumpObjectType,
  type FromSnapshotOut,
  type OnOversize,
  type ReconcileDatabaseItem,
  type ServerOut,
  type SnapshotLayout,
} from '@/lib/contracts'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useReconcile } from '@/features/servers/hooks/use-reconcile'
import { useDatabaseSnapshot } from '@/features/servers/hooks/use-snapshot'
import { useCreateModelFromSnapshot } from '../hooks/use-from-snapshot'
import {
  buildFromSnapshotBody,
  countByType,
  dataCandidates,
  defaultObjectSelection,
  hasNonPortable,
  objectKey,
  previewVersions,
  resolveSelectedStatements,
  slugify,
  validateManualLayout,
  type DataCandidate,
  type LayoutProblem,
  type ObjectSelection,
  type SchemaBucketDraft,
  type TypeSelectionMode,
  type VersionPreview,
} from './logic'

export type WizardStep =
  | 'origin'
  | 'preview'
  | 'objects'
  | 'layout'
  | 'manual'
  | 'data'
  | 'summary'
  | 'result'

/** Etapas del indicador de pasos (el paso `manual` cae bajo «Versionado»). */
export const WIZARD_STAGES: { key: WizardStep; label: string }[] = [
  { key: 'origin', label: 'Origen' },
  { key: 'preview', label: 'Preview' },
  { key: 'objects', label: 'Objetos' },
  { key: 'layout', label: 'Versionado' },
  { key: 'data', label: 'Datos' },
  { key: 'summary', label: 'Resumen' },
]

const DEFAULT_BASELINE_NAME = 'Snapshot baseline'
let bucketSeq = 0
const nextBucketId = () => `b${(bucketSeq += 1)}`

export interface SnapshotWizard {
  // ── Navegación ──────────────────────────────────────────────────────────
  step: WizardStep
  order: WizardStep[]
  stageIndex: number
  canBack: boolean
  next: () => void
  back: () => void
  goToStep: (step: WizardStep) => void

  // ── Origen (Vista 1) ────────────────────────────────────────────────────
  presetLocked: boolean
  server: ServerOut | null
  serverId: number | null
  database: string | null
  setServer: (server: ServerOut | null) => void
  setDatabase: (database: string | null) => void
  servers: ReturnType<typeof useServerOptions>
  reconcile: ReturnType<typeof useReconcile>
  /** BDs del servidor con su estado de reconciliación; las `unmanaged` son las candidatas. */
  databaseItems: ReconcileDatabaseItem[]

  // ── Preview (Vista 2) ───────────────────────────────────────────────────
  snapshot: ReturnType<typeof useDatabaseSnapshot>
  includeDataStats: boolean
  setIncludeDataStats: (value: boolean) => void

  // ── Selección de objetos (Vista 3) ──────────────────────────────────────
  selection: ObjectSelection
  setTypeMode: (mode: TypeSelectionMode) => void
  toggleType: (type: DumpObjectType) => void
  toggleObjectExcluded: (key: string) => void
  applyPortableShortcut: () => void
  presentTypes: DumpObjectType[]
  selectedStatements: ReturnType<typeof resolveSelectedStatements>
  selectedCounts: Partial<Record<DumpObjectType, number>>
  schemaPortable: boolean

  // ── Versionado (Vistas 4 y 5) ───────────────────────────────────────────
  layout: SnapshotLayout
  setLayout: (layout: SnapshotLayout) => void
  versionPreview: VersionPreview[]
  manualBuckets: SchemaBucketDraft[]
  manualProblems: LayoutProblem[]
  addSchemaBucket: () => void
  removeBucket: (id: string) => void
  renameBucket: (id: string, name: string) => void
  moveBucket: (id: string, direction: -1 | 1) => void
  assignObject: (key: string, bucketId: string) => void
  unassignObject: (key: string) => void
  reseedByClass: () => void
  bucketOfObject: Map<string, string>

  // ── Datos-semilla (Vista 5b) ────────────────────────────────────────────
  dataCandidateList: DataCandidate[]
  dataModes: Record<string, DataSeedMode>
  toggleDataTable: (table: string) => void
  setDataMode: (table: string, mode: DataSeedMode) => void
  onOversize: OnOversize
  setOnOversize: (value: OnOversize) => void
  confirmDataRollback: boolean
  setConfirmDataRollback: (value: boolean) => void
  dataCount: number
  dataSelections: { table: string; mode: DataSeedMode }[]

  // ── Identidad (Vista 6) ─────────────────────────────────────────────────
  name: string
  setName: (value: string) => void
  slug: string
  setSlug: (value: string) => void
  slugValid: boolean
  description: string
  setDescription: (value: string) => void
  baselineName: string
  setBaselineName: (value: string) => void

  // ── Envío ───────────────────────────────────────────────────────────────
  create: ReturnType<typeof useCreateModelFromSnapshot>
  result: FromSnapshotOut | null
  submit: () => void
  submitExpress: () => void
  reset: () => void
}

interface WizardOptions {
  presetServerId?: number
  presetDatabase?: string
}

/**
 * Estado, navegación y derivaciones del asistente "Crear blueprint desde snapshot" (Plan 09 §6).
 * Centraliza todo el flujo para que cada paso sea una vista tonta que lee y escribe aquí.
 */
export function useSnapshotWizard(options: WizardOptions = {}): SnapshotWizard {
  const presetLocked = options.presetServerId !== undefined && options.presetDatabase !== undefined

  const [step, setStep] = useState<WizardStep>('origin')
  const [server, setServerState] = useState<ServerOut | null>(null)
  const [database, setDatabaseState] = useState<string | null>(options.presetDatabase ?? null)
  const [includeDataStats, setIncludeDataStats] = useState(false)

  const [selection, setSelection] = useState<ObjectSelection>(defaultObjectSelection)
  const [layout, setLayoutState] = useState<SnapshotLayout>('single')
  const [manualBuckets, setManualBuckets] = useState<SchemaBucketDraft[]>([])

  const [dataModes, setDataModes] = useState<Record<string, DataSeedMode>>({})
  const [onOversize, setOnOversize] = useState<OnOversize>('skip')
  const [confirmDataRollback, setConfirmDataRollback] = useState(false)

  const [name, setName] = useState('')
  const [slug, setSlugState] = useState('')
  const [slugDirty, setSlugDirty] = useState(false)
  const [description, setDescription] = useState('')
  const [baselineName, setBaselineName] = useState(DEFAULT_BASELINE_NAME)

  const [result, setResult] = useState<FromSnapshotOut | null>(null)

  const servers = useServerOptions()
  const serverId = options.presetServerId ?? server?.id ?? null
  const reconcile = useReconcile(
    serverId ?? 0,
    !presetLocked && Number.isFinite(serverId) && (serverId ?? 0) > 0,
  )
  // Solo son fotografiables las BDs que existen en el motor (managed/unmanaged); las orphan no.
  const databaseItems = useMemo(
    () => (reconcile.data?.databases ?? []).filter((db) => db.state !== 'orphan'),
    [reconcile.data],
  )
  const snapshot = useDatabaseSnapshot(
    serverId ?? 0,
    database,
    step !== 'origin' && Boolean(serverId) && Boolean(database),
    includeDataStats,
  )
  const create = useCreateModelFromSnapshot()

  // ── Derivaciones sobre el snapshot + la selección ─────────────────────────
  const statements = useMemo(() => snapshot.data?.statements ?? [], [snapshot.data])
  const presentTypes = useMemo(() => {
    const set = new Set<DumpObjectType>()
    for (const s of statements) set.add(s.object_type)
    return [...set]
  }, [statements])
  const selectedStatements = useMemo(
    () => resolveSelectedStatements(statements, selection),
    [statements, selection],
  )
  const selectedCounts = useMemo(() => countByType(selectedStatements), [selectedStatements])
  const schemaPortable = useMemo(() => !hasNonPortable(selectedStatements), [selectedStatements])

  const dataCandidateList = useMemo(
    () => dataCandidates(snapshot.data?.table_stats, selectedStatements),
    [snapshot.data, selectedStatements],
  )
  const dataSelections = useMemo(() => {
    const eligible = new Set(dataCandidateList.filter((c) => c.hasPrimaryKey).map((c) => c.table))
    return Object.entries(dataModes)
      .filter(([table]) => eligible.has(table))
      .map(([table, mode]) => ({ table, mode }))
  }, [dataModes, dataCandidateList])
  const dataCount = dataSelections.length

  const versionPreview = useMemo(
    () => previewVersions(selectedStatements, layout, baselineName.trim() || DEFAULT_BASELINE_NAME, dataCount),
    [selectedStatements, layout, baselineName, dataCount],
  )

  const manualProblems = useMemo(
    () => (layout === 'manual' ? validateManualLayout(manualBuckets, selectedStatements) : []),
    [layout, manualBuckets, selectedStatements],
  )
  const bucketOfObject = useMemo(() => {
    const map = new Map<string, string>()
    for (const bucket of manualBuckets) {
      for (const key of bucket.objectKeys) map.set(key, bucket.id)
    }
    return map
  }, [manualBuckets])

  const slugValid = SLUG_PATTERN.test(slug)

  // ── Navegación ────────────────────────────────────────────────────────────
  const order = useMemo<WizardStep[]>(() => {
    const base: WizardStep[] = ['origin', 'preview', 'objects', 'layout']
    if (layout === 'manual') base.push('manual')
    base.push('data', 'summary')
    return base
  }, [layout])

  const stageIndex = useMemo(() => {
    const stageKey: WizardStep = step === 'manual' ? 'layout' : step
    return WIZARD_STAGES.findIndex((s) => s.key === stageKey)
  }, [step])

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
  const canBack = step !== 'origin' && step !== 'result'

  // ── Origen ────────────────────────────────────────────────────────────────
  const resetSnapshotState = useCallback(() => {
    setSelection(defaultObjectSelection)
    setLayoutState('single')
    setManualBuckets([])
    setDataModes({})
    setIncludeDataStats(false)
  }, [])

  const setServer = useCallback(
    (value: ServerOut | null) => {
      setServerState(value)
      setDatabaseState(null)
      resetSnapshotState()
    },
    [resetSnapshotState],
  )
  const setDatabase = useCallback(
    (value: string | null) => {
      setDatabaseState(value)
      resetSnapshotState()
    },
    [resetSnapshotState],
  )

  // ── Selección de objetos ───────────────────────────────────────────────────
  const setTypeMode = useCallback((mode: TypeSelectionMode) => {
    setSelection((prev) => ({ ...prev, typeMode: mode }))
    setManualBuckets([])
  }, [])
  const toggleType = useCallback((type: DumpObjectType) => {
    setSelection((prev) => ({
      ...prev,
      types: prev.types.includes(type)
        ? prev.types.filter((t) => t !== type)
        : [...prev.types, type],
    }))
    setManualBuckets([])
  }, [])
  const toggleObjectExcluded = useCallback((key: string) => {
    setSelection((prev) => ({
      ...prev,
      excludedObjectKeys: prev.excludedObjectKeys.includes(key)
        ? prev.excludedObjectKeys.filter((k) => k !== key)
        : [...prev.excludedObjectKeys, key],
    }))
    setManualBuckets([])
  }, [])
  const applyPortableShortcut = useCallback(() => {
    setSelection((prev) => ({
      ...prev,
      typeMode: 'exclude',
      types: Array.from(new Set([...prev.types, 'routine', 'trigger', 'event'])),
    }))
    setManualBuckets([])
  }, [])

  // ── Versionado ──────────────────────────────────────────────────────────────
  const seedByClass = useCallback((): SchemaBucketDraft[] => {
    const groups: { label: string; test: (t: DumpObjectType) => boolean }[] = [
      { label: 'Prerrequisitos', test: (t) => t === 'extension' || t === 'type' || t === 'sequence' },
      { label: 'Tablas e índices', test: (t) => t === 'table' || t === 'index' },
      { label: 'Vistas', test: (t) => t === 'view' },
      { label: 'Vistas materializadas', test: (t) => t === 'materialized_view' },
      { label: 'Rutinas', test: (t) => t === 'routine' },
      { label: 'Triggers', test: (t) => t === 'trigger' },
      { label: 'Eventos', test: (t) => t === 'event' },
    ]
    const buckets: SchemaBucketDraft[] = []
    for (const group of groups) {
      const keys = selectedStatements
        .filter((s) => group.test(s.object_type))
        .map((s) => objectKey(s))
      if (keys.length > 0) buckets.push({ id: nextBucketId(), name: group.label, objectKeys: keys })
    }
    return buckets
  }, [selectedStatements])

  const setLayout = useCallback(
    (value: SnapshotLayout) => {
      setLayoutState(value)
      if (value === 'manual') setManualBuckets((prev) => (prev.length > 0 ? prev : seedByClass()))
    },
    [seedByClass],
  )
  const reseedByClass = useCallback(() => setManualBuckets(seedByClass()), [seedByClass])

  const addSchemaBucket = useCallback(() => {
    setManualBuckets((prev) => [
      ...prev,
      { id: nextBucketId(), name: `Versión ${prev.length + 1}`, objectKeys: [] },
    ])
  }, [])
  const removeBucket = useCallback((id: string) => {
    setManualBuckets((prev) => prev.filter((b) => b.id !== id))
  }, [])
  const renameBucket = useCallback((id: string, value: string) => {
    setManualBuckets((prev) => prev.map((b) => (b.id === id ? { ...b, name: value } : b)))
  }, [])
  const moveBucket = useCallback((id: string, direction: -1 | 1) => {
    setManualBuckets((prev) => {
      const idx = prev.findIndex((b) => b.id === id)
      const target = idx + direction
      if (idx < 0 || target < 0 || target >= prev.length) return prev
      const copy = [...prev]
      const [moved] = copy.splice(idx, 1)
      copy.splice(target, 0, moved!)
      return copy
    })
  }, [])
  const assignObject = useCallback((key: string, bucketId: string) => {
    setManualBuckets((prev) =>
      prev.map((b) => {
        const without = b.objectKeys.filter((k) => k !== key)
        if (b.id === bucketId) return { ...b, objectKeys: [...without, key] }
        return without.length === b.objectKeys.length ? b : { ...b, objectKeys: without }
      }),
    )
  }, [])
  const unassignObject = useCallback((key: string) => {
    setManualBuckets((prev) =>
      prev.map((b) =>
        b.objectKeys.includes(key) ? { ...b, objectKeys: b.objectKeys.filter((k) => k !== key) } : b,
      ),
    )
  }, [])

  // ── Datos-semilla ────────────────────────────────────────────────────────────
  const toggleDataTable = useCallback((table: string) => {
    setDataModes((prev) => {
      if (table in prev) {
        const next = { ...prev }
        delete next[table]
        return next
      }
      return { ...prev, [table]: 'upsert' }
    })
  }, [])
  const setDataMode = useCallback((table: string, mode: DataSeedMode) => {
    setDataModes((prev) => (table in prev ? { ...prev, [table]: mode } : prev))
  }, [])

  // ── Identidad ──────────────────────────────────────────────────────────────
  const setNameAndSlug = useCallback(
    (value: string) => {
      setName(value)
      if (!slugDirty) setSlugState(slugify(value))
    },
    [slugDirty],
  )
  const setSlug = useCallback((value: string) => {
    setSlugState(value)
    setSlugDirty(true)
  }, [])

  // ── Envío ────────────────────────────────────────────────────────────────────
  const submit = useCallback(() => {
    const body = buildFromSnapshotBody({
      serverId: serverId ?? 0,
      database: database ?? '',
      name,
      slug,
      description,
      baselineName,
      layout,
      selection,
      manualBuckets,
      dataSelections,
      onOversize,
      confirmDataRollback,
    })
    create.mutate(body, {
      onSuccess: (data) => {
        setResult(data)
        setStep('result')
      },
    })
  }, [
    create,
    serverId,
    database,
    name,
    slug,
    description,
    baselineName,
    layout,
    selection,
    manualBuckets,
    dataSelections,
    onOversize,
    confirmDataRollback,
  ])

  const submitExpress = useCallback(() => {
    // Camino "1 clic": deriva la identidad del nombre de la BD si aún no se ha escrito y captura
    // todo el esquema en una sola versión, sin datos ni filtros. Ante error (p. ej. slug 409) lleva
    // al Resumen para ajustar la identidad con el error visible.
    const effectiveName = name.trim() || database || 'Blueprint'
    const effectiveSlug = slug.trim() && slugDirty ? slug.trim() : slugify(effectiveName)
    if (!name.trim()) {
      setName(effectiveName)
      setSlugState(effectiveSlug)
    }
    const body = buildFromSnapshotBody({
      serverId: serverId ?? 0,
      database: database ?? '',
      name: effectiveName,
      slug: effectiveSlug,
      description,
      baselineName,
      layout: 'single',
      selection: defaultObjectSelection,
      manualBuckets: [],
      dataSelections: [],
      onOversize: 'skip',
      confirmDataRollback: false,
    })
    create.mutate(body, {
      onSuccess: (data) => {
        setResult(data)
        setStep('result')
      },
      onError: () => setStep('summary'),
    })
  }, [create, serverId, database, name, slug, slugDirty, description, baselineName])

  const reset = useCallback(() => {
    setStep('origin')
    if (!presetLocked) {
      setServerState(null)
      setDatabaseState(null)
    }
    resetSnapshotState()
    setOnOversize('skip')
    setConfirmDataRollback(false)
    setName('')
    setSlugState('')
    setSlugDirty(false)
    setDescription('')
    setBaselineName(DEFAULT_BASELINE_NAME)
    setResult(null)
    create.reset()
  }, [presetLocked, resetSnapshotState, create])

  return {
    step,
    order,
    stageIndex,
    canBack,
    next,
    back,
    goToStep,
    presetLocked,
    server,
    serverId,
    database,
    setServer,
    setDatabase,
    servers,
    reconcile,
    databaseItems,
    snapshot,
    includeDataStats,
    setIncludeDataStats,
    selection,
    setTypeMode,
    toggleType,
    toggleObjectExcluded,
    applyPortableShortcut,
    presentTypes,
    selectedStatements,
    selectedCounts,
    schemaPortable,
    layout,
    setLayout,
    versionPreview,
    manualBuckets,
    manualProblems,
    addSchemaBucket,
    removeBucket,
    renameBucket,
    moveBucket,
    assignObject,
    unassignObject,
    reseedByClass,
    bucketOfObject,
    dataCandidateList,
    dataModes,
    toggleDataTable,
    setDataMode,
    onOversize,
    setOnOversize,
    confirmDataRollback,
    setConfirmDataRollback,
    dataCount,
    dataSelections,
    name,
    setName: setNameAndSlug,
    slug,
    setSlug,
    slugValid,
    description,
    setDescription,
    baselineName,
    setBaselineName,
    create,
    result,
    submit,
    submitExpress,
    reset,
  }
}
