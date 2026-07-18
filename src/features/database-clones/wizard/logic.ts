import type {
  CloneCreateIn,
  CloneExecuteIn,
  CloneObjectOut,
  CloneObjectRef,
  CloneObjectType,
  ClonePreviewIn,
  EngineType,
  ManagedDatabaseOut,
  ReconcileDatabaseItem,
  ServerOut,
} from '@/lib/contracts'
import type { BadgeTone } from '@/components/ui'

/**
 * Lógica pura del asistente de clonado de bases de datos (`database-clones`). Sin React ni
 * efectos: resolución de motor, opciones de origen (BD del inventario o cruda), construcción de
 * los cuerpos de `create`/`preview`/`execute`, y helpers de selección/portabilidad. Todo aquí es
 * testeable en aislamiento (ver `logic.test.ts`).
 */

// ── Etiquetas ────────────────────────────────────────────────────────────────
export const CLONE_OBJECT_TYPE_LABELS: Record<CloneObjectType, string> = {
  table: 'Tabla',
  view: 'Vista',
  materialized_view: 'Vista materializada',
  routine: 'Rutina',
  trigger: 'Trigger',
  sequence: 'Secuencia',
  enum_type: 'Tipo enum',
  extension: 'Extensión',
  event: 'Evento',
}

// ── Origen (Vista 1) — unifica "BD del inventario" y "BD cruda" ─────────────────
/**
 * Una opción del selector de origen: o bien una BD YA adoptada (`managedId` no nulo, con su
 * `modelId` para saber si `adopt_target` es posible), o una BD "cruda" que solo existe en vivo
 * en el motor del servidor (`managedId: null`).
 */
export interface CloneSourceOption {
  key: string
  name: string
  serverId: number
  resolvedEngine?: EngineType
  managedId: number | null
  modelId: number | null
}

export function resolveDatabaseEngine(
  db: ManagedDatabaseOut,
  serverById: Map<number, ServerOut>,
): EngineType | undefined {
  return db.engine ?? serverById.get(db.server_id)?.engine
}

/** Opciones de origen a partir del inventario de BDs gestionadas (todas, sin filtrar por motor). */
export function managedDatabasesToSourceOptions(
  databases: ManagedDatabaseOut[],
  serverById: Map<number, ServerOut>,
): CloneSourceOption[] {
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
 * Opciones de origen a partir de `GET /servers/{id}/reconcile`: TODAS las BDs vivas de un
 * servidor (adoptadas o no). Las `orphan` (en inventario pero ya no existen en el motor) se
 * excluyen: no hay nada real que clonar.
 */
export function reconcileItemsToSourceOptions(
  items: ReconcileDatabaseItem[],
  serverId: number,
  engine: EngineType | undefined,
  modelIdByManagedId: Map<number, number | null>,
): CloneSourceOption[] {
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

/** Opciones de destino EXISTENTE de un servidor: mismo origen de datos que el origen, sin `orphan`. */
export function reconcileItemsToTargetOptions(
  items: ReconcileDatabaseItem[],
  serverId: number,
  engine: EngineType | undefined,
  modelIdByManagedId: Map<number, number | null>,
): CloneSourceOption[] {
  return reconcileItemsToSourceOptions(items, serverId, engine, modelIdByManagedId)
}

// ── Construcción del body de creación ────────────────────────────────────────────
export interface PlanFormState {
  source: CloneSourceOption | null
  targetServerId: number | null
  targetMode: 'new' | 'existing'
  targetDatabaseName: string
  /** Solo si `targetMode === 'existing'` y se eligió de la lista en vivo del servidor. */
  targetExisting: CloneSourceOption | null
  includeData: boolean
  cleanMode: 'none' | 'objects' | 'drop_database'
  adoptTarget: boolean
  adoptOwnerId: number | null
}

export const INITIAL_PLAN_FORM: PlanFormState = {
  source: null,
  targetServerId: null,
  targetMode: 'new',
  targetDatabaseName: '',
  targetExisting: null,
  includeData: false,
  cleanMode: 'none',
  adoptTarget: false,
  adoptOwnerId: null,
}

/** `true` si el origen es una BD gestionada CON blueprint — condición necesaria para `adoptTarget`. */
export function canAdoptTarget(plan: PlanFormState, planMode: 'complete' | 'partial'): boolean {
  return planMode === 'complete' && plan.source != null && plan.source.modelId != null
}

/**
 * Cuerpo de `POST /database-clones`. `selection` nunca se manda aquí: el clon completo es el
 * default del backend (`null`), y la selección parcial real se resuelve y persiste recién en
 * `preview` (Vista 3 → 4), una vez que el usuario terminó de armar el cierre de dependencias.
 */
export function buildCreateCloneBody(plan: PlanFormState): CloneCreateIn | null {
  if (!plan.source || plan.targetServerId == null) return null
  const targetName =
    plan.targetMode === 'existing' && plan.targetExisting
      ? plan.targetExisting.name
      : plan.targetDatabaseName.trim()
  if (!targetName) return null

  return {
    source_database_id: plan.source.managedId,
    source_server_id: plan.source.managedId != null ? null : plan.source.serverId,
    source_database_name: plan.source.managedId != null ? null : plan.source.name,
    target_server_id: plan.targetServerId,
    target_database_name: targetName,
    target_database_id: plan.targetMode === 'existing' ? (plan.targetExisting?.managedId ?? null) : null,
    target_mode: plan.targetMode,
    include_data: plan.includeData,
    clean_mode: plan.targetMode === 'existing' ? plan.cleanMode : 'none',
    adopt_target: canAdoptTarget(plan, 'complete') && plan.adoptTarget,
    adopt_owner_id: plan.adoptTarget ? plan.adoptOwnerId : null,
    selection: null,
  }
}

export function buildPreviewBody(selection: CloneObjectRef[] | null): ClonePreviewIn {
  return { selection }
}

export function buildExecuteBody(input: {
  confirmTargetName: string
  confirmToken: string
  force: boolean
}): CloneExecuteIn {
  return {
    confirm_target_name: input.confirmTargetName,
    confirm_token: input.confirmToken,
    force: input.force,
  }
}

// ── Selección de objetos (Vista 3) ────────────────────────────────────────────────
export function cloneRefKey(ref: CloneObjectRef): string {
  return `${ref.object_type}:${ref.name}`
}

/** Mapa de selección (clave `type:name` → ref completa) para poder recuperar `object_type` al leer. */
export function toggleCloneObjectSelection(
  selection: ReadonlyMap<string, CloneObjectRef>,
  ref: CloneObjectRef,
): Map<string, CloneObjectRef> {
  const next = new Map(selection)
  const key = cloneRefKey(ref)
  if (next.has(key)) next.delete(key)
  else next.set(key, ref)
  return next
}

/** Agrupa los objetos del inventario por `object_type`, preservando el orden de aparición. */
export function groupObjectsByType(
  objects: CloneObjectOut[],
): { objectType: CloneObjectType; objects: CloneObjectOut[] }[] {
  const order: CloneObjectType[] = []
  const groups = new Map<CloneObjectType, CloneObjectOut[]>()
  for (const object of objects) {
    if (!groups.has(object.object_type)) {
      groups.set(object.object_type, [])
      order.push(object.object_type)
    }
    groups.get(object.object_type)!.push(object)
  }
  return order.map((objectType) => ({ objectType, objects: groups.get(objectType)! }))
}

/** Tono del badge de portabilidad: no portable → error; portable con reserva (best-effort) → warning. */
export function portabilityTone(object: CloneObjectOut): BadgeTone {
  if (!object.portable) return 'error'
  if (object.portability_reason) return 'warning'
  return 'success'
}
