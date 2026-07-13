import type {
  AdoptComparisonIn,
  EngineType,
  ExecuteComparisonIn,
  ManagedDatabaseOut,
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
 * ítems. El atajo "todo" NUNCA incluye un objeto `requires_individual_review` que aún no fue
 * revisado (su checkbox está deshabilitado hasta entonces): incluirlo igual produciría un
 * checkbox marcado-pero-bloqueado que el usuario no podría desmarcar por UI.
 */
export function resolveShortcutSelection(
  items: SchemaComparisonItemOut[],
  shortcut: SelectionShortcut,
  reviewedItemIds: ReadonlySet<number> = new Set(),
): Set<number> {
  if (shortcut === 'none') return new Set()
  if (shortcut === 'all') {
    return new Set(
      items
        .filter((item) => !item.risk_flags.requires_individual_review || reviewedItemIds.has(item.id))
        .map((item) => item.id),
    )
  }
  return new Set(items.filter(isSafeAdditive).map((item) => item.id))
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
  selectedItemIds: ReadonlySet<number>
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
