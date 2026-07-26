import type {
  AdoptComparisonIn,
  CreateSchemaComparisonIn,
  EngineType,
  ExecuteComparisonIn,
  ManagedDatabaseOut,
  ReconcileDatabaseItem,
  SchemaChangeType,
  SchemaComparisonCounts,
  SchemaComparisonItemOut,
  SchemaObjectType,
  ServerOut,
} from '@/lib/contracts'

/**
 * Lógica pura del asistente de comparación de esquemas (`schema-comparisons`). Sin React ni
 * efectos: resolución de motor/familia, agrupación y conteos de ítems, atajos de selección,
 * el gate de "revisión individual" para objetos procedurales y la construcción de los cuerpos
 * de `adopt`/`execute`. Todo aquí es testeable en aislamiento (ver `logic.test.ts`).
 */

// ── Etiquetas ────────────────────────────────────────────────────────────────
export const OBJECT_TYPE_LABELS: Record<SchemaObjectType, string> = {
  table: 'Tabla',
  column: 'Columna',
  primary_key: 'Clave primaria',
  foreign_key: 'Clave foránea',
  unique_constraint: 'Restricción única',
  check_constraint: 'Restricción check',
  index: 'Índice',
  view: 'Vista',
  materialized_view: 'Vista materializada',
  routine: 'Rutina',
  trigger: 'Trigger',
  event: 'Evento',
  sequence: 'Secuencia',
  enum_type: 'Tipo enum',
  extension: 'Extensión',
}

export const CHANGE_TYPE_LABELS: Record<SchemaChangeType, string> = {
  new: 'Nuevo',
  modified: 'Modificado',
  dropped: 'Eliminado',
}

// ── Motor / familia (Vista 1) ─────────────────────────────────────────────────
export type EngineFamily = 'mysql_mariadb' | 'postgresql'

export const ENGINE_FAMILY_LABELS: Record<EngineFamily, string> = {
  mysql_mariadb: 'MySQL / MariaDB',
  postgresql: 'PostgreSQL',
}

/** Motores que pertenecen a cada familia: determina qué llamadas `?engine=` hace el selector. */
export const ENGINES_BY_FAMILY: Record<EngineFamily, EngineType[]> = {
  mysql_mariadb: ['mysql', 'mariadb'],
  postgresql: ['postgresql'],
}

export function resolveEngineFamily(engine: EngineType): EngineFamily {
  return engine === 'postgresql' ? 'postgresql' : 'mysql_mariadb'
}

/**
 * Resuelve el motor de una BD gestionada: usa `engine` si el backend lo expone directamente,
 * si no, lo deriva por join con el servidor (`SUPUESTO 1` del documento de referencia).
 */
export function resolveDatabaseEngine(
  db: ManagedDatabaseOut,
  serverById: Map<number, ServerOut>,
): EngineType | undefined {
  return db.engine ?? serverById.get(db.server_id)?.engine
}

/**
 * Regla de compatibilidad de motores para comparar (§ Restricción de motor + cross-flavor):
 * mismo motor siempre; MySQL↔MariaDB permitido; PostgreSQL solo consigo mismo.
 */
export function canCompareEngines(source: EngineType, target: EngineType): boolean {
  if (source === target) return true
  return resolveEngineFamily(source) === 'mysql_mariadb' && resolveEngineFamily(target) === 'mysql_mariadb'
}

/** `true` si la combinación de motores dispara el aviso de ruido esperable MySQL↔MariaDB. */
export function isCrossFlavorPair(source: EngineType, target: EngineType): boolean {
  return source !== target && canCompareEngines(source, target)
}

// ── Selector de BDs (Vista 1) — unifica "adoptada" y "cruda sin registrar" ──────
/**
 * Una opción del selector de source/target (feature "referencias crudas"): o bien una BD YA
 * adoptada (`managedId` no nulo, con su `modelId` para la rama A/B), o una BD "cruda" que solo
 * existe en vivo en el motor del servidor (`managedId: null`) — comparable igual, pero que
 * nunca podrá pasar por Opción A (adoptar como blueprint) mientras no se registre.
 */
export interface DatabaseSideOption {
  key: string
  name: string
  serverId: number
  resolvedEngine?: EngineType
  managedId: number | null
  modelId: number | null
}

/** Opciones del modo "por motor": BDs adoptadas del motor/familia elegida (comportamiento previo). */
export function managedDatabasesToOptions(
  databases: ManagedDatabaseOut[],
  serverById: Map<number, ServerOut>,
): DatabaseSideOption[] {
  return databases.map((db) => ({
    key: `managed:${db.id}`,
    name: db.name,
    serverId: db.server_id,
    resolvedEngine: resolveDatabaseEngine(db, serverById),
    managedId: db.id,
    modelId: db.model_id ?? null,
  }))
}

/**
 * Opciones del modo "por servidor": TODAS las BDs vivas de un servidor (adoptadas o no),
 * combinando `GET /servers/{id}/reconcile` (estado managed/unmanaged/orphan) con el `model_id`
 * de las que sí están en inventario (`modelIdByManagedId`, cruzado por `managed_id`). Las
 * `orphan` (en inventario pero ya no existen en el motor) se excluyen: no hay nada real que
 * comparar. Un servidor tiene un único motor, así que `engine` es el mismo para toda la lista.
 */
export function reconcileItemsToOptions(
  items: ReconcileDatabaseItem[],
  serverId: number,
  engine: EngineType | undefined,
  modelIdByManagedId: Map<number, number | null>,
): DatabaseSideOption[] {
  return items
    .filter((item) => item.state !== 'orphan')
    .map((item) => ({
      key: item.managed_id != null ? `managed:${item.managed_id}` : `raw:${serverId}:${item.name}`,
      name: item.name,
      serverId,
      resolvedEngine: engine,
      managedId: item.managed_id ?? null,
      modelId: item.managed_id != null ? (modelIdByManagedId.get(item.managed_id) ?? null) : null,
    }))
}

function buildSideFields(
  prefix: 'source' | 'target',
  option: DatabaseSideOption,
): Partial<CreateSchemaComparisonIn> {
  if (option.managedId != null) {
    return prefix === 'source'
      ? { source_database_id: option.managedId }
      : { target_database_id: option.managedId }
  }
  return prefix === 'source'
    ? { source_server_id: option.serverId, source_database_name: option.name }
    : { target_server_id: option.serverId, target_database_name: option.name }
}

/**
 * Cuerpo de `POST /schema-comparisons`: cada lado por `database_id` (BD adoptada) o por
 * referencia cruda `server_id`+`database_name` (BD sin registrar) — nunca ambas ni ninguna.
 */
export function buildCreateComparisonBody(
  source: DatabaseSideOption,
  target: DatabaseSideOption,
): CreateSchemaComparisonIn {
  return { ...buildSideFields('source', source), ...buildSideFields('target', target) }
}

// ── Objetos procedurales (limitación conocida v1 de Opción A) ───────────────────
/**
 * Objetos con cuerpo procedural (`BEGIN...END` en MySQL/MariaDB). Adoptarlos vía Opción A puede
 * fallar al aplicarse porque el splitter de sentencias corta mal el `;` interno — es una
 * limitación conocida de v1, documentada en la doc técnica del backend. No se puede reusar
 * `NON_PORTABLE_OBJECT_TYPES` de `snapshot.ts`: está tipado contra `DumpObjectType`, un enum
 * distinto (aunque solapado) al `SchemaObjectType` de esta feature.
 */
export const PROCEDURAL_OBJECT_TYPES = new Set<SchemaObjectType>(['routine', 'trigger', 'event'])

/** `true` si algún ítem SELECCIONADO es procedural y el motor del target es MySQL/MariaDB. */
export function hasMysqlProceduralRisk(
  items: SchemaComparisonItemOut[],
  selectedItemIds: ReadonlySet<number>,
  targetEngine: EngineType | undefined,
): boolean {
  if (targetEngine === 'postgresql' || !targetEngine) return false
  return items.some(
    (item) => selectedItemIds.has(item.id) && PROCEDURAL_OBJECT_TYPES.has(item.object_type),
  )
}

// ── Conteos y composición (Vista 2 — DiffCompositionChart) ──────────────────────
export interface CompositionRow {
  objectType: string
  label: string
  new: number
  modified: number
  dropped: number
  total: number
}

/** Ordena `counts` (del resumen) por magnitud total descendente, para el gráfico de barras. */
export function compositionRows(counts: SchemaComparisonCounts): CompositionRow[] {
  return Object.entries(counts)
    .map(([objectType, byChange]) => {
      const n = byChange.new ?? 0
      const m = byChange.modified ?? 0
      const d = byChange.dropped ?? 0
      return {
        objectType,
        label: OBJECT_TYPE_LABELS[objectType as SchemaObjectType] ?? objectType,
        new: n,
        modified: m,
        dropped: d,
        total: n + m + d,
      }
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
}

// ── Agrupación por objeto (Vista 3) ─────────────────────────────────────────────
/** Agrupa los ítems de la página actual por `object_name`, preservando el orden de aparición. */
export function groupItemsByObjectName(
  items: SchemaComparisonItemOut[],
): { objectName: string; items: SchemaComparisonItemOut[] }[] {
  const order: string[] = []
  const groups = new Map<string, SchemaComparisonItemOut[]>()
  for (const item of items) {
    if (!groups.has(item.object_name)) {
      groups.set(item.object_name, [])
      order.push(item.object_name)
    }
    groups.get(item.object_name)!.push(item)
  }
  return order.map((objectName) => ({ objectName, items: groups.get(objectName)! }))
}

// ── Grupos atómicos (op_group, §10.3) ────────────────────────────────────────────
/**
 * Agrupa los ítems por `op_group` (solo los que lo tienen: `op_group: null` = ítem suelto de una
 * comparación vieja, se trata como individual). Base de toda la selección atómica: un mismo
 * `op_group` = un mismo cambio lógico (p. ej. redefinición: DROP + CREATE) que debe viajar
 * completo a adopt/execute — media selección da 422.
 */
export function groupItemsByOpGroup(
  items: SchemaComparisonItemOut[],
): Map<string, SchemaComparisonItemOut[]> {
  const groups = new Map<string, SchemaComparisonItemOut[]>()
  for (const item of items) {
    if (item.op_group == null) continue
    const bucket = groups.get(item.op_group)
    if (bucket) bucket.push(item)
    else groups.set(item.op_group, [item])
  }
  return groups
}

/** Miembros del grupo atómico de un ítem (él mismo si no tiene `op_group`). */
function atomicGroupMembers(
  item: SchemaComparisonItemOut,
  byOpGroup: Map<string, SchemaComparisonItemOut[]>,
): SchemaComparisonItemOut[] {
  return item.op_group != null ? (byOpGroup.get(item.op_group) ?? [item]) : [item]
}

/**
 * Marca/desmarca un ítem de forma ATÓMICA: todas las filas de su `op_group` cambian juntas
 * (los ítems con `op_group: null` se comportan como hoy: individuales). El sentido lo decide el
 * ítem tocado: si estaba desmarcado se marca TODO el grupo, si estaba marcado se desmarca TODO
 * — así un grupo a medias (imposible por UI, pero defensivo) converge a un estado consistente.
 */
export function toggleSelectionAtomic(
  items: SchemaComparisonItemOut[],
  selectedItemIds: ReadonlySet<number>,
  itemId: number,
): Set<number> {
  const next = new Set(selectedItemIds)
  const item = items.find((candidate) => candidate.id === itemId)
  if (!item) {
    // Ítem fuera del conjunto cargado (no debería pasar): degradar al toggle individual previo.
    if (next.has(itemId)) next.delete(itemId)
    else next.add(itemId)
    return next
  }
  const members = atomicGroupMembers(item, groupItemsByOpGroup(items))
  const willSelect = !selectedItemIds.has(itemId)
  for (const member of members) {
    if (willSelect) next.add(member.id)
    else next.delete(member.id)
  }
  return next
}

/**
 * Ids cuyo checkbox debe estar DESHABILITADO por el gate de revisión individual, extendido al
 * grupo atómico: si CUALQUIER miembro del grupo es procedural y aún no fue revisado, se bloquea
 * el grupo COMPLETO — permitir marcar solo la mitad revisada rompería la atomicidad (422).
 * Para ítems sin grupo es el gate original (él mismo procedural y sin revisar).
 */
export function reviewBlockedIds(
  items: SchemaComparisonItemOut[],
  reviewedItemIds: ReadonlySet<number>,
): Set<number> {
  const byOpGroup = groupItemsByOpGroup(items)
  const blocked = new Set<number>()
  for (const item of items) {
    const members = atomicGroupMembers(item, byOpGroup)
    if (
      members.some(
        (member) =>
          member.risk_flags.requires_individual_review && !reviewedItemIds.has(member.id),
      )
    ) {
      blocked.add(item.id)
    }
  }
  return blocked
}

// ── Selección (Vistas 4a/5a) ─────────────────────────────────────────────────────
/**
 * "Aditivo seguro": objeto nuevo sin NINGUNA bandera de riesgo activa. Es solo un atajo de
 * conveniencia (el usuario puede ajustar la selección manualmente después), no una garantía del
 * backend — documentado así en el propio texto de la UI.
 */
export function isSafeAdditive(item: SchemaComparisonItemOut): boolean {
  const flags = item.risk_flags
  return (
    item.change_type === 'new' &&
    !flags.destructive &&
    !flags.lock_heavy &&
    !flags.data_conversion &&
    !flags.needs_review &&
    !flags.requires_individual_review
  )
}

export type SelectionShortcut = 'all' | 'safeAdditive' | 'none'

/**
 * Resuelve el conjunto de ids resultante de aplicar un atajo sobre el conjunto completo de
 * ítems, respetando la atomicidad por `op_group`:
 * - "todo" NUNCA incluye un grupo con algún procedural (`requires_individual_review`) aún sin
 *   revisar (mismo criterio que `reviewBlockedIds`): incluirlo produciría un checkbox
 *   marcado-pero-bloqueado que el usuario no podría desmarcar por UI.
 * - "aditivos seguros" solo incluye grupos donde TODOS los miembros son aditivos seguros —
 *   incluir solo el CREATE de una redefinición (dejando fuera su DROP) mandaría media selección
 *   y el backend respondería 422.
 */
export function resolveShortcutSelection(
  items: SchemaComparisonItemOut[],
  shortcut: SelectionShortcut,
  reviewedItemIds: ReadonlySet<number> = new Set(),
): Set<number> {
  if (shortcut === 'none') return new Set()
  if (shortcut === 'all') {
    const blocked = reviewBlockedIds(items, reviewedItemIds)
    return new Set(items.filter((item) => !blocked.has(item.id)).map((item) => item.id))
  }
  const byOpGroup = groupItemsByOpGroup(items)
  return new Set(
    items
      .filter((item) => atomicGroupMembers(item, byOpGroup).every(isSafeAdditive))
      .map((item) => item.id),
  )
}

// ── Dependencias entre grupos (depends_on, §10.3) ────────────────────────────────
export interface DependencyWarning {
  /** `op_group` del que se depende y que NO está seleccionado. */
  missingOpGroup: string
  /** Nombre(s) de objeto del grupo faltante (para un texto legible). */
  missingObjectNames: string[]
  /** Nombre(s) de objeto de los ítems seleccionados que lo requieren. */
  requiredBy: string[]
}

/** Nombres de objeto (únicos, en orden de aparición) de un `op_group`; cae al id crudo del
 * grupo si ningún ítem cargado pertenece a él. */
export function opGroupObjectNames(items: SchemaComparisonItemOut[], opGroup: string): string[] {
  const names: string[] = []
  for (const item of items) {
    if (item.op_group === opGroup && !names.includes(item.object_name)) names.push(item.object_name)
  }
  return names.length > 0 ? names : [opGroup]
}

/**
 * Advertencia (NO bloqueante) de selección con dependencias sin satisfacer: grupos de los que
 * dependen ítems SELECCIONADOS (`depends_on`) y que no tienen ningún ítem seleccionado. Es solo
 * el aviso pedagógico del paso de selección — el cierre REAL lo hace `resolve-selection` al
 * pasar a confirmar (y el 422 del backend queda como red de seguridad final).
 */
export function unsatisfiedDependencyWarnings(
  items: SchemaComparisonItemOut[],
  selectedItemIds: ReadonlySet<number>,
): DependencyWarning[] {
  const byOpGroup = groupItemsByOpGroup(items)
  const selectedOpGroups = new Set<string>()
  for (const item of items) {
    if (item.op_group != null && selectedItemIds.has(item.id)) selectedOpGroups.add(item.op_group)
  }

  const requiredByPerGroup = new Map<string, string[]>()
  for (const item of items) {
    if (!selectedItemIds.has(item.id)) continue
    for (const dependency of item.depends_on) {
      // Solo dependencias presentes en ESTA comparación (el contrato solo lista esas) y aún no
      // seleccionadas. Si el grupo no aparece entre los ítems cargados, no hay nada que avisar.
      if (selectedOpGroups.has(dependency) || !byOpGroup.has(dependency)) continue
      const requiredBy = requiredByPerGroup.get(dependency) ?? []
      if (!requiredBy.includes(item.object_name)) requiredBy.push(item.object_name)
      requiredByPerGroup.set(dependency, requiredBy)
    }
  }

  return [...requiredByPerGroup.entries()].map(([missingOpGroup, requiredBy]) => ({
    missingOpGroup,
    missingObjectNames: opGroupObjectNames(items, missingOpGroup),
    requiredBy,
  }))
}

/**
 * Ítems seleccionados que son procedurales (`requires_individual_review`) pero cuyo cuerpo SQL
 * completo aún no fue expandido/revisado por el usuario — deben bloquear el envío (Opción A/B).
 */
export function pendingIndividualReviewIds(
  items: SchemaComparisonItemOut[],
  selectedItemIds: ReadonlySet<number>,
  reviewedItemIds: ReadonlySet<number>,
): number[] {
  return items
    .filter(
      (item) =>
        selectedItemIds.has(item.id) &&
        item.risk_flags.requires_individual_review &&
        !reviewedItemIds.has(item.id),
    )
    .map((item) => item.id)
}

// ── Construcción de cuerpos de request ──────────────────────────────────────────
export interface AdoptBodyInput {
  /**
   * Selección FINAL, ya cerrada por `resolve-selection`: sus `resolved_item_ids` vienen en orden
   * de ejecución y se reenvían tal cual (por eso es un array ordenado y no un Set). NUNCA se
   * manda `auto_resolve_dependencies: true`: el cierre es explícito y visible antes de confirmar.
   */
  selectedItemIds: readonly number[]
  name: string
  description: string
  executeImmediately: boolean
}

export function buildAdoptBody(input: AdoptBodyInput): AdoptComparisonIn {
  const body: AdoptComparisonIn = {
    selected_item_ids: [...input.selectedItemIds],
    name: input.name.trim(),
    execute_immediately: input.executeImmediately,
  }
  const description = input.description.trim()
  if (description) body.description = description
  return body
}

export function buildExecuteBody(input: {
  mode: ExecuteComparisonIn['mode']
  selectedItemIds: ReadonlySet<number>
  confirmTargetName: string
  confirmToken: string
}): ExecuteComparisonIn {
  return {
    mode: input.mode,
    selected_item_ids: input.mode === 'custom' ? [...input.selectedItemIds] : null,
    confirm_target_name: input.confirmTargetName,
    confirm_token: input.confirmToken,
  }
}
