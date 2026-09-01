import type {
  CloneBatchCreateIn,
  CloneBatchItemStatus,
  CloneBatchStatus,
  CloneCopyIntent,
  CloneDataOnExisting,
  CloneTargetMode,
  ReconcileDatabaseItem,
} from '@/lib/contracts'
import type { BadgeTone } from '@/components/ui'
import {
  buildStructureSpec,
  INITIAL_RULE_SELECTION,
  type RuleSelectionState,
} from '@/features/database-clones/wizard/logic'

/**
 * Lógica pura del asistente de LOTES de clonación. Sin React ni efectos.
 *
 * La regla que gobierna casi todo lo de acá: **el lote no borra el destino**. De ahí salen dos
 * consecuencias que la UI tiene que hacer visibles en vez de dejar que las descubra el 422:
 * con destino EXISTENTE la única intención posible es `data_only`, y no hay forma de "vaciar y
 * recargar" (`truncate` no existe en el contrato).
 */

// ── Una fila del lote ─────────────────────────────────────────────────────────────
export interface BatchRowDraft {
  /** Nombre en el ORIGEN. Es también la clave de la fila: es único por servidor. */
  sourceDatabaseName: string
  /** Id del inventario si la base está adoptada; null si es cruda. */
  sourceDatabaseId: number | null
  targetDatabaseName: string
  targetMode: CloneTargetMode
}

export interface BatchPlanState {
  sourceServerId: number | null
  targetServerId: number | null
  copyIntent: CloneCopyIntent
  dataOnExisting: CloneDataOnExisting
  /** Selección declarativa aplicada a TODAS las filas (reusa la del asistente individual). */
  rule: RuleSelectionState
  /** Filas elegidas, indexadas por nombre de origen para que el orden de tildado no importe. */
  rows: Map<string, BatchRowDraft>
}

export const INITIAL_BATCH_PLAN: BatchPlanState = {
  sourceServerId: null,
  targetServerId: null,
  copyIntent: 'structure_and_data',
  dataOnExisting: 'append',
  rule: INITIAL_RULE_SELECTION,
  rows: new Map(),
}

/** Bases del servidor origen que se pueden clonar. Las `orphan` no existen en el motor. */
export function clonableDatabases(items: ReconcileDatabaseItem[]): ReconcileDatabaseItem[] {
  return items.filter((item) => item.state !== 'orphan')
}

export function toggleRow(
  rows: ReadonlyMap<string, BatchRowDraft>,
  item: ReconcileDatabaseItem,
): Map<string, BatchRowDraft> {
  const next = new Map(rows)
  if (next.has(item.name)) next.delete(item.name)
  else
    next.set(item.name, {
      sourceDatabaseName: item.name,
      sourceDatabaseId: item.managed_id ?? null,
      // El default es el MISMO nombre: es lo que se quiere casi siempre, y renombrar es la
      // excepción. Que el default sea editable por fila es todo el punto de la columna.
      targetDatabaseName: item.name,
      targetMode: 'new',
    })
  return next
}

export function setAllRows(
  rows: ReadonlyMap<string, BatchRowDraft>,
  items: ReconcileDatabaseItem[],
  selected: boolean,
): Map<string, BatchRowDraft> {
  if (!selected) return new Map()
  const next = new Map(rows)
  for (const item of items) {
    if (next.has(item.name)) continue
    next.set(item.name, {
      sourceDatabaseName: item.name,
      sourceDatabaseId: item.managed_id ?? null,
      targetDatabaseName: item.name,
      targetMode: 'new',
    })
  }
  return next
}

export function patchRow(
  rows: ReadonlyMap<string, BatchRowDraft>,
  key: string,
  patch: Partial<BatchRowDraft>,
): Map<string, BatchRowDraft> {
  const current = rows.get(key)
  if (!current) return new Map(rows)
  const next = new Map(rows)
  next.set(key, { ...current, ...patch })
  return next
}

/**
 * Aplica un prefijo y/o un sufijo al nombre destino de TODAS las filas, siempre a partir del
 * nombre de ORIGEN y no del actual. Partir del actual haría que aplicarlo dos veces produjera
 * `stg_stg_ventas`, que es el error que se comete al segundo intento.
 */
export function applyAffixToRows(
  rows: ReadonlyMap<string, BatchRowDraft>,
  { prefix, suffix }: { prefix: string; suffix: string },
): Map<string, BatchRowDraft> {
  const next = new Map<string, BatchRowDraft>()
  for (const [key, row] of rows) {
    next.set(key, {
      ...row,
      targetDatabaseName: `${prefix}${row.sourceDatabaseName}${suffix}`,
    })
  }
  return next
}

/** Nombres destino repetidos dentro del lote. El backend los rechaza; acá se avisan antes. */
export function duplicateTargetNames(rows: ReadonlyMap<string, BatchRowDraft>): Set<string> {
  const vistos = new Set<string>()
  const repetidos = new Set<string>()
  for (const row of rows.values()) {
    const nombre = row.targetDatabaseName.trim()
    if (vistos.has(nombre)) repetidos.add(nombre)
    else vistos.add(nombre)
  }
  return repetidos
}

/**
 * Filas cuyo modo no es representable: con destino EXISTENTE el lote solo puede copiar datos,
 * porque no borra y por lo tanto no puede emitir DDL sobre objetos que ya están.
 */
export function rowsNeedingDataOnly(
  rows: ReadonlyMap<string, BatchRowDraft>,
  copyIntent: CloneCopyIntent,
): string[] {
  if (copyIntent === 'data_only') return []
  return [...rows.values()]
    .filter((row) => row.targetMode === 'existing')
    .map((row) => row.targetDatabaseName)
}

/** `null` si el plan todavía no es enviable — mismo criterio que el asistente individual. */
export function buildCreateBatchBody(plan: BatchPlanState): CloneBatchCreateIn | null {
  if (plan.sourceServerId == null || plan.targetServerId == null) return null
  if (plan.rows.size === 0) return null
  if (duplicateTargetNames(plan.rows).size > 0) return null
  if (rowsNeedingDataOnly(plan.rows, plan.copyIntent).length > 0) return null
  if ([...plan.rows.values()].some((row) => !row.targetDatabaseName.trim())) return null

  const structure = buildStructureSpec(plan.rule)
  const recortaAlgo =
    structure.types.length > 0 ||
    structure.include_patterns.length > 0 ||
    structure.exclude_patterns.length > 0

  return {
    source_server_id: plan.sourceServerId,
    target_server_id: plan.targetServerId,
    copy_intent: plan.copyIntent,
    // Solo viaja donde el backend lo admite: en las otras intenciones da 422, porque allá las
    // tablas las crea el propio job y nacen vacías.
    data_on_existing: plan.copyIntent === 'data_only' ? plan.dataOnExisting : null,
    structure: recortaAlgo ? structure : null,
    data: null,
    target_charset: null,
    rows: [...plan.rows.values()].map((row) => ({
      source_database_name: row.sourceDatabaseName,
      source_database_id: row.sourceDatabaseId,
      target_database_name: row.targetDatabaseName.trim(),
      target_mode: row.targetMode,
      overrides: null,
    })),
  }
}

// ── Presentación ──────────────────────────────────────────────────────────────────
const ITEM_STATUS_LABELS: Record<CloneBatchItemStatus, string> = {
  pending: 'en espera',
  running: 'clonando',
  succeeded: 'clonada',
  failed: 'falló',
  blocked: 'bloqueada',
  skipped: 'no arrancó',
  interrupted: 'interrumpida',
  canceled: 'cancelada',
}

const ITEM_STATUS_TONES: Record<CloneBatchItemStatus, BadgeTone> = {
  pending: 'neutral',
  running: 'primary',
  succeeded: 'success',
  failed: 'error',
  blocked: 'warning',
  skipped: 'neutral',
  interrupted: 'warning',
  canceled: 'neutral',
}

export function itemStatusLabel(status: CloneBatchItemStatus | null | undefined): string {
  return status ? ITEM_STATUS_LABELS[status] : '—'
}

export function itemStatusTone(status: CloneBatchItemStatus | null | undefined): BadgeTone {
  return status ? ITEM_STATUS_TONES[status] : 'neutral'
}

const BATCH_STATUS_LABELS: Record<CloneBatchStatus, string> = {
  pending: 'sin confirmar',
  running: 'en curso',
  done: 'completado',
  partial: 'completado con fallos',
  failed: 'falló',
  interrupted: 'interrumpido',
  canceled: 'cancelado',
}

const BATCH_STATUS_TONES: Record<CloneBatchStatus, BadgeTone> = {
  pending: 'neutral',
  running: 'primary',
  done: 'success',
  partial: 'warning',
  failed: 'error',
  interrupted: 'warning',
  canceled: 'neutral',
}

export function batchStatusLabel(status: CloneBatchStatus): string {
  return BATCH_STATUS_LABELS[status]
}

export function batchStatusTone(status: CloneBatchStatus): BadgeTone {
  return BATCH_STATUS_TONES[status]
}

// ── Duración por base ─────────────────────────────────────────────────────────────
// NO necesita ningún campo nuevo del backend: `CloneBatchItemOut` ya trae `started_at` y
// `finished_at` por ítem. Es lo que convierte «se sintió lento» en «la base X tardó 41 min».

export interface BatchRowDuration {
  key: number
  label: string
  ms: number | null
  /**
   * Preparación: de que arranca la fila a que el worker reclama el job. Ahí corren el snapshot
   * del origen de `create_plan`, el de `preview` y una consulta de estadísticas por tabla.
   */
  prepMs: number | null
  /** Ejecución del job: lock, snapshot anti-TOCTOU, limpieza, DDL y copia de datos. */
  execMs: number | null
  status: CloneBatchItemStatus | null | undefined
}

/**
 * Duración de una fila, o `null` si no arrancó o no terminó.
 *
 * **Qué mide exactamente**: el backend marca `started_at` ANTES de `create_plan`, así que esto
 * abarca la preparación, los snapshots del origen, la limpieza, el DDL y la copia — la base
 * completa, no solo la copia. La distinción no es académica: en una medición real de 17 MB en
 * 2 m 18 s, la copia valía uno o dos segundos, y llamar «copia» al total llevaba a optimizar
 * el lugar equivocado.
 *
 * Hasta hace poco esto era verdad de la columna de la BD pero **no** de lo que llegaba: la API
 * sustituía los dos campos por los del job en cuanto la fila tenía uno, así que la preparación
 * caía fuera de la barra y aparecía como «sin atribuir». Ya no: el backend manda los dos pares.
 */
export function rowDurationMs(row: {
  started_at?: string | null
  finished_at?: string | null
}): number | null {
  if (!row.started_at || !row.finished_at) return null
  const ms = new Date(row.finished_at).getTime() - new Date(row.started_at).getTime()
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

/** Milisegundos entre dos marcas, o `null` si falta alguna o el orden es imposible. */
function spanMs(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null
  const ms = new Date(to).getTime() - new Date(from).getTime()
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

/**
 * Duraciones por base, ordenadas de mayor a menor: el orden pone al culpable primero, que es
 * la pregunta real («¿cuál se comió el tiempo?»). Las filas sin duración van al final.
 */
export function durationsByDatabase(
  items: {
    id: number
    target_database_name: string
    status?: CloneBatchItemStatus | null
    started_at?: string | null
    finished_at?: string | null
    job_started_at?: string | null
    job_finished_at?: string | null
  }[],
): BatchRowDuration[] {
  return items
    .map((row) => ({
      key: row.id,
      label: row.target_database_name,
      ms: rowDurationMs(row),
      prepMs: spanMs(row.started_at, row.job_started_at),
      execMs: spanMs(row.job_started_at, row.job_finished_at),
      status: row.status,
    }))
    .sort((a, b) => (b.ms ?? -1) - (a.ms ?? -1))
}

/**
 * El total del lote, la suma de sus bases, y **el resto sin atribuir**.
 *
 * En serie el total no es la suma, así que el resto existe y hay que mostrarlo. Lo que NO se
 * puede hacer es nombrarlo: la primera versión lo llamaba «esperando turno y arranque», y eso
 * no está demostrado — entre el fin de una fila y el inicio de la siguiente el worker solo
 * consulta la cancelación y abre una sesión, o sea milisegundos, no los 25 s por base que una
 * medición real arrojó. Se llama «sin atribuir» hasta que la instrumentación permita repartirlo.
 *
 * Un número con una etiqueta inventada es peor que un número sin etiqueta: manda a optimizar
 * un lugar que nadie verificó.
 */
export function batchQueueGapMs(
  batch: { started_at?: string | null; finished_at?: string | null },
  duraciones: BatchRowDuration[],
): { totalMs: number | null; sumaMs: number; huecoMs: number | null } {
  const totalMs = rowDurationMs(batch)
  const sumaMs = duraciones.reduce((acc, d) => acc + (d.ms ?? 0), 0)
  return {
    totalMs,
    sumaMs,
    huecoMs: totalMs != null ? Math.max(0, totalMs - sumaMs) : null,
  }
}

/** «4 de 12»: cuántas filas llegaron a un desenlace, sea cual sea. */
export function completedCount(counts: Record<string, number>): number {
  const total = counts.total ?? 0
  const pendientes = (counts.pending ?? 0) + (counts.running ?? 0)
  return Math.max(0, total - pendientes)
}
