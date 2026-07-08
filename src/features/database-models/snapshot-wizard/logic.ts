import {
  NON_PORTABLE_OBJECT_TYPES,
  type DataSeedMode,
  type DumpObjectType,
  type DumpStatement,
  type FromSnapshotIn,
  type ManualBucket,
  type SnapshotLayout,
  type SnapshotObjectRef,
  type StructureDump,
  type TableStat,
} from '@/lib/contracts'

/**
 * Lógica pura del asistente "Crear blueprint desde snapshot" (Plan 09 §6). Sin React ni efectos:
 * resuelve la selección de objetos, calcula portabilidad y previsualización de versiones, valida
 * el layout manual en cliente y compone el cuerpo `FromSnapshotIn`. Todo aquí es testeable en
 * aislamiento.
 */

// ── Etiquetas y orden de tipos ───────────────────────────────────────────────
export const OBJECT_TYPE_LABELS: Record<DumpObjectType, string> = {
  table: 'Tablas',
  view: 'Vistas',
  materialized_view: 'Vistas materializadas',
  routine: 'Rutinas',
  trigger: 'Triggers',
  sequence: 'Secuencias',
  type: 'Tipos',
  extension: 'Extensiones',
  index: 'Índices',
  event: 'Eventos',
}

/** Etiqueta en singular para conteos y resúmenes ("1 tabla, 3 vistas"). */
export const OBJECT_TYPE_LABELS_SINGULAR: Record<DumpObjectType, string> = {
  table: 'tabla',
  view: 'vista',
  materialized_view: 'vista materializada',
  routine: 'rutina',
  trigger: 'trigger',
  sequence: 'secuencia',
  type: 'tipo',
  extension: 'extensión',
  index: 'índice',
  event: 'evento',
}

/** Clave estable de un objeto/sentencia: `tipo:nombre`. */
export function objectKey(ref: { object_type: DumpObjectType; name: string }): string {
  return `${ref.object_type}:${ref.name}`
}

// ── Selección de objetos (Vista 3) ───────────────────────────────────────────
export type TypeSelectionMode = 'all' | 'include' | 'exclude'

export interface ObjectSelection {
  typeMode: TypeSelectionMode
  /** Tipos elegidos para el modo include/exclude. */
  types: DumpObjectType[]
  /** Objetos concretos deseleccionados (claves `objectKey`). Alimenta `exclude_objects`. */
  excludedObjectKeys: string[]
}

export const defaultObjectSelection: ObjectSelection = {
  typeMode: 'all',
  types: [],
  excludedObjectKeys: [],
}

/**
 * Resuelve el conjunto de sentencias seleccionadas aplicando, en orden: filtro por tipo
 * (include/exclude) y luego la deselección fina por objeto. Determinista → el preview de la UI
 * coincide con lo que se enviará.
 */
export function resolveSelectedStatements(
  statements: DumpStatement[],
  selection: ObjectSelection,
): DumpStatement[] {
  const typeSet = new Set(selection.types)
  const excluded = new Set(selection.excludedObjectKeys)
  return statements.filter((stmt) => {
    if (selection.typeMode === 'include' && !typeSet.has(stmt.object_type)) return false
    if (selection.typeMode === 'exclude' && typeSet.has(stmt.object_type)) return false
    return !excluded.has(objectKey(stmt))
  })
}

/** Conteo por tipo de un conjunto de sentencias. */
export function countByType(statements: DumpStatement[]): Partial<Record<DumpObjectType, number>> {
  const counts: Partial<Record<DumpObjectType, number>> = {}
  for (const stmt of statements) {
    counts[stmt.object_type] = (counts[stmt.object_type] ?? 0) + 1
  }
  return counts
}

/** Conteo por tipo del snapshot completo: usa `object_counts` del backend o lo deriva. */
export function snapshotObjectCounts(dump: StructureDump): Partial<Record<DumpObjectType, number>> {
  if (dump.object_counts && Object.keys(dump.object_counts).length > 0) {
    return dump.object_counts
  }
  return countByType(dump.statements)
}

/** Un conjunto es no portable si incluye rutinas/triggers/events (atan el blueprint al motor). */
export function hasNonPortable(statements: DumpStatement[]): boolean {
  return statements.some((stmt) => NON_PORTABLE_OBJECT_TYPES.has(stmt.object_type))
}

/** Resumen legible de conteos, p. ej. "12 tablas, 3 vistas". */
export function summarizeCounts(counts: Partial<Record<DumpObjectType, number>>): string {
  const parts: string[] = []
  for (const type of TYPE_ORDER) {
    const n = counts[type]
    if (!n) continue
    const label = n === 1 ? OBJECT_TYPE_LABELS_SINGULAR[type] : OBJECT_TYPE_LABELS[type].toLowerCase()
    parts.push(`${n} ${label}`)
  }
  return parts.length > 0 ? parts.join(', ') : 'sin objetos'
}

// ── Previsualización de versiones by_class / single (Vista 4, estimada) ────────
/** Orden canónico de tipos para listados y agrupación por clase. */
export const TYPE_ORDER: DumpObjectType[] = [
  'extension',
  'type',
  'sequence',
  'table',
  'index',
  'view',
  'materialized_view',
  'routine',
  'trigger',
  'event',
]

/** Clases de versionado `by_class` en orden de dependencia (prerrequisitos → datos al final). */
const BY_CLASS_GROUPS: { label: string; types: DumpObjectType[] }[] = [
  { label: 'Prerrequisitos', types: ['extension', 'type', 'sequence'] },
  { label: 'Tablas e índices', types: ['table', 'index'] },
  { label: 'Vistas', types: ['view'] },
  { label: 'Vistas materializadas', types: ['materialized_view'] },
  { label: 'Rutinas', types: ['routine'] },
  { label: 'Triggers', types: ['trigger'] },
  { label: 'Eventos', types: ['event'] },
]

export interface VersionPreview {
  /** Número estimado (1-based); el backend lo fija tras ocultar clases vacías. */
  index: number
  name: string
  kind: 'schema' | 'data'
  counts: Partial<Record<DumpObjectType, number>>
  hasNonPortable: boolean
}

/**
 * Previsualización estimada de las versiones para `single`/`by_class` (SUPUESTO C). La numeración
 * final la fija el backend. `dataTableCount` añade las versiones de datos al final.
 */
export function previewVersions(
  selected: DumpStatement[],
  layout: SnapshotLayout,
  baselineName: string,
  dataTableCount = 0,
): VersionPreview[] {
  const versions: VersionPreview[] = []

  if (layout === 'single') {
    if (selected.length > 0) {
      versions.push({
        index: 1,
        name: baselineName,
        kind: 'schema',
        counts: countByType(selected),
        hasNonPortable: hasNonPortable(selected),
      })
    }
  } else {
    // by_class: una versión por grupo no vacío, en orden de dependencia.
    for (const group of BY_CLASS_GROUPS) {
      const inGroup = selected.filter((s) => group.types.includes(s.object_type))
      if (inGroup.length === 0) continue
      versions.push({
        index: versions.length + 1,
        name: group.label,
        kind: 'schema',
        counts: countByType(inGroup),
        hasNonPortable: hasNonPortable(inGroup),
      })
    }
  }

  for (let i = 0; i < dataTableCount; i += 1) {
    versions.push({
      index: versions.length + 1,
      name: `Datos ${i + 1}`,
      kind: 'data',
      counts: {},
      hasNonPortable: true,
    })
  }

  return versions
}

// ── Datos-semilla (Vista 5b) ─────────────────────────────────────────────────
export interface DataCandidate {
  table: string
  estimatedRows: number
  hasPrimaryKey: boolean
  /** La estructura de esta tabla está incluida en la selección de esquema. */
  structureIncluded: boolean
}

/**
 * Tablas candidatas a datos-semilla: intersección de `table_stats` con las tablas cuya estructura
 * está en la selección. Solo estas pueden sembrarse.
 */
export function dataCandidates(
  tableStats: TableStat[] | null | undefined,
  selectedSchema: DumpStatement[],
): DataCandidate[] {
  if (!tableStats) return []
  const includedTables = new Set(
    selectedSchema.filter((s) => s.object_type === 'table').map((s) => s.name),
  )
  return tableStats
    .filter((stat) => includedTables.has(stat.table))
    .map((stat) => ({
      table: stat.table,
      estimatedRows: stat.estimated_rows,
      hasPrimaryKey: stat.has_primary_key,
      structureIncluded: true,
    }))
}

/** Umbral orientativo para avisar "muchas filas" en la UI (el guardrail real lo aplica el backend). */
export const HIGH_ROW_ESTIMATE = 5000

// ── Layout manual (Vista 5) ──────────────────────────────────────────────────
export interface SchemaBucketDraft {
  id: string
  name: string
  /** Claves `objectKey` de los objetos de esquema asignados, en orden. */
  objectKeys: string[]
}

/** Problema de validación en cliente del layout manual, ligado a un bucket/objeto concreto. */
export interface LayoutProblem {
  reason: string
  message: string
  /** Índice 0-based del bucket implicado (si aplica). */
  bucketIndex?: number
  /** Clave del objeto implicado (si aplica). */
  objectKey?: string
}

/**
 * Valida el layout manual en cliente (validación de conveniencia; la topológica completa —FK,
 * vista→vista— la hace el backend). Cubre: buckets vacíos, objetos sin asignar, duplicados y
 * dependencias en versión posterior. Los datos van por la Vista 5b (versiones al final), por lo
 * que aquí solo hay buckets de esquema.
 */
export function validateManualLayout(
  buckets: SchemaBucketDraft[],
  selected: DumpStatement[],
): LayoutProblem[] {
  const problems: LayoutProblem[] = []
  const byKey = new Map(selected.map((s) => [objectKey(s), s]))
  const selectedKeys = new Set(byKey.keys())

  // Bucket vacío.
  buckets.forEach((bucket, index) => {
    if (bucket.objectKeys.length === 0) {
      problems.push({
        reason: 'empty_bucket',
        message: `La versión «${bucket.name || index + 1}» está vacía. Añade objetos o elimínala.`,
        bucketIndex: index,
      })
    }
  })

  // Asignación: mapa objeto → índice de versión (1-based). Detecta duplicados y desconocidos.
  const versionOf = new Map<string, number>()
  buckets.forEach((bucket, index) => {
    for (const key of bucket.objectKeys) {
      if (!selectedKeys.has(key)) {
        problems.push({
          reason: 'unknown_object',
          message: `El objeto ${key} no está en la selección. Quítalo de la versión ${index + 1}.`,
          bucketIndex: index,
          objectKey: key,
        })
        continue
      }
      if (versionOf.has(key)) {
        problems.push({
          reason: 'duplicate_assignment',
          message: `El objeto ${key} está en dos versiones (también en la v${versionOf.get(key)}). Déjalo en una sola.`,
          bucketIndex: index,
          objectKey: key,
        })
        continue
      }
      versionOf.set(key, index + 1)
    }
  })

  // Objetos seleccionados sin asignar.
  for (const key of selectedKeys) {
    if (!versionOf.has(key)) {
      problems.push({
        reason: 'unassigned_object',
        message: `«${key}» está seleccionado pero no asignado a ninguna versión. Asígnalo.`,
        objectKey: key,
      })
    }
  }

  // Dependencia en versión posterior: un objeto no puede depender de una tabla en una versión > la suya.
  buckets.forEach((bucket, index) => {
    for (const key of bucket.objectKeys) {
      const stmt = byKey.get(key)
      if (!stmt) continue
      for (const dep of stmt.depends_on) {
        const depVersion = versionOf.get(objectKey({ object_type: 'table', name: dep }))
        if (depVersion !== undefined && depVersion > index + 1) {
          problems.push({
            reason: 'dependency_in_later_version',
            message: `«${stmt.name}» depende de «${dep}», que está en una versión posterior (v${depVersion}). Muévelo después.`,
            bucketIndex: index,
            objectKey: key,
          })
        }
      }
    }
  })

  return problems
}

// ── Construcción del cuerpo FromSnapshotIn (Vista 6) ──────────────────────────
export interface WizardBodyInput {
  serverId: number
  database: string
  name: string
  slug: string
  description: string
  baselineName: string
  layout: SnapshotLayout
  selection: ObjectSelection
  manualBuckets: SchemaBucketDraft[]
  /** Tabla → modo de siembra. Vacío = sin datos. */
  dataSelections: { table: string; mode: DataSeedMode }[]
  onOversize: 'skip' | 'error'
  confirmDataRollback: boolean
}

const DEFAULT_BASELINE_NAME = 'Snapshot baseline'

/**
 * Compone el cuerpo `FromSnapshotIn` a partir del estado del asistente. Emite solo los campos que
 * difieren del default para mantener el payload mínimo y retrocompatible.
 */
export function buildFromSnapshotBody(input: WizardBodyInput): FromSnapshotIn {
  const body: Record<string, unknown> = {
    server_id: input.serverId,
    database: input.database,
    name: input.name.trim(),
    slug: input.slug.trim(),
  }

  const description = input.description.trim()
  if (description) body.description = description

  const baseline = input.baselineName.trim()
  if (baseline && baseline !== DEFAULT_BASELINE_NAME) body.baseline_name = baseline

  if (input.layout !== 'single') body.layout = input.layout

  // Filtros por tipo (Vista 3).
  if (input.selection.typeMode === 'include' && input.selection.types.length > 0) {
    body.include_object_types = input.selection.types
  } else if (input.selection.typeMode === 'exclude' && input.selection.types.length > 0) {
    body.exclude_object_types = input.selection.types
  }
  // Deselección fina por objeto.
  if (input.selection.excludedObjectKeys.length > 0) {
    body.exclude_objects = input.selection.excludedObjectKeys.map(parseObjectKey)
  }

  // Layout manual (solo buckets de esquema; los datos van al final vía data_tables).
  if (input.layout === 'manual') {
    body.manual_layout = input.manualBuckets.map<ManualBucket>((bucket) => ({
      name: bucket.name.trim() || undefined,
      objects: bucket.objectKeys.map(parseObjectKey),
    }))
  }

  // Datos-semilla.
  if (input.dataSelections.length > 0) {
    body.data_tables = input.dataSelections.map((sel) => ({ table: sel.table, mode: sel.mode }))
    if (input.onOversize !== 'skip') body.on_oversize = input.onOversize
    if (input.confirmDataRollback) body.confirm_data_rollback = true
  }

  return body as unknown as FromSnapshotIn
}

/** Parsea una clave `tipo:nombre` a `SnapshotObjectRef` (el nombre puede contener `:`). */
export function parseObjectKey(key: string): SnapshotObjectRef {
  const separator = key.indexOf(':')
  return {
    object_type: key.slice(0, separator) as DumpObjectType,
    name: key.slice(separator + 1),
  }
}

// ── Genera un slug estable a partir del nombre (kebab en minúsculas). ──────────
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
