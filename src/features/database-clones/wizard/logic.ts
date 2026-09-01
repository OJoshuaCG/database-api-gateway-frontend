import type {
  CloneCreateIn,
  CloneExecuteIn,
  CloneObjectOut,
  CloneObjectRef,
  CloneObjectType,
  ClonePreviewIn,
  CloneStructureSpec,
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

/**
 * Cuerpo de `POST .../preview`. **Emite UN SOLO idioma de selección por llamada**, que es lo que
 * el backend exige: valida sobre las claves REALMENTE enviadas, así que mandar `selection: null`
 * acompañando a `structure` ya cuenta como enviar las dos y responde 422.
 */
export function buildPreviewBody(plan: CloneSelectionPlan): ClonePreviewIn {
  if (plan.kind === 'rule') return { structure: plan.structure }
  return { selection: plan.kind === 'manual' ? plan.refs : null }
}

/** Clave estable del plan de selección, para la query key del preview. */
export function selectionPlanKey(plan: CloneSelectionPlan): string {
  if (plan.kind === 'full') return 'full'
  if (plan.kind === 'manual') return `manual:${plan.refs.map(cloneRefKey).sort().join('|')}`
  const spec = plan.structure
  return [
    'rule',
    spec.mode,
    [...spec.types].sort().join(','),
    [...spec.names].sort().join(','),
    [...spec.include_patterns].sort().join(','),
    [...spec.exclude_patterns].sort().join(','),
  ].join(';')
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

// ── Los DOS idiomas de la selección parcial ───────────────────────────────────────
/**
 * `manual` = marcar objeto por objeto (refs exactas, con cierre de dependencias en vivo).
 * `rule` = describir la selección con tipos y patrones, y que el backend la resuelva contra el
 * catálogo del origen. Son mutuamente excluyentes por contrato, no por elección de esta UI.
 */
export type CloneSelectionKind = 'manual' | 'rule'

/** Estado del formulario del modo `rule`. Los patrones se escriben como texto libre y se parsean. */
export interface RuleSelectionState {
  /** Vacío = todos los tipos del catálogo. */
  types: CloneObjectType[]
  includePatterns: string
  excludePatterns: string
}

export const INITIAL_RULE_SELECTION: RuleSelectionState = {
  types: [],
  includePatterns: '',
  excludePatterns: '',
}

export type CloneSelectionPlan =
  | { kind: 'full' }
  | { kind: 'manual'; refs: CloneObjectRef[] }
  | { kind: 'rule'; structure: CloneStructureSpec }

/** Separa por comas y/o espacios, recorta, descarta vacíos y deduplica preservando el orden. */
export function parsePatternList(raw: string): string[] {
  const seen = new Set<string>()
  const patterns: string[] = []
  for (const token of raw.split(/[\s,]+/)) {
    const pattern = token.trim()
    if (!pattern || seen.has(pattern)) continue
    seen.add(pattern)
    patterns.push(pattern)
  }
  return patterns
}

/**
 * Spec declarativo a partir del formulario de reglas.
 *
 * **El modo base es SIEMPRE `all`, y no es un detalle**: el backend aplica `mode` sobre `names`
 * ANTES de filtrar por patrones, así que `mode: 'include'` con `names: []` deja el conjunto base
 * vacío y unos `include_patterns` sin `names` no seleccionarían nada. Para «los objetos que
 * matcheen X» el modo correcto es `all` + `include_patterns`, que es lo que se arma acá.
 */
export function buildStructureSpec(rule: RuleSelectionState): CloneStructureSpec {
  return {
    mode: 'all',
    types: rule.types,
    names: [],
    include_patterns: parsePatternList(rule.includePatterns),
    exclude_patterns: parsePatternList(rule.excludePatterns),
  }
}

/** `true` si la regla no recorta nada, o sea que equivale a un clon completo. */
export function ruleSelectsEverything(spec: CloneStructureSpec): boolean {
  return (
    spec.mode === 'all' &&
    spec.types.length === 0 &&
    spec.include_patterns.length === 0 &&
    spec.exclude_patterns.length === 0
  )
}

// Prefijos de la contabilidad interna del gateway (`identifiers.GATEWAY_TABLE_PREFIXES`). El
// backend las excluye de toda selección; se replican acá para que el conteo en pantalla no
// prometa objetos que el plan real no va a incluir.
const GATEWAY_TABLE_PREFIXES = ['_gw_v_', '_gw_stg_']

export function isGatewayInternalTable(name: string): boolean {
  const lowered = name.toLowerCase()
  return GATEWAY_TABLE_PREFIXES.some((prefix) => lowered.startsWith(prefix))
}

function escapeRegExpChar(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Traduce un patrón `fnmatch` a `RegExp`, replicando `fnmatch.fnmatchcase` de Python (el que usa
 * `export_spec.resolve_selection`): `*` cualquier secuencia, `?` un carácter, `[seq]` / `[!seq]`
 * clases, y un `[` sin cierre es literal. Sensible a mayúsculas, como del lado del servidor.
 *
 * Es solo para el CONTEO que se muestra mientras se escribe la regla: la resolución autoritativa
 * la hace el backend contra el catálogo real en `preview`.
 */
function globToRegExp(pattern: string): RegExp {
  let source = ''
  let index = 0
  while (index < pattern.length) {
    const char = pattern[index]!
    index += 1
    if (char === '*') {
      source += '.*'
      continue
    }
    if (char === '?') {
      source += '.'
      continue
    }
    if (char !== '[') {
      source += escapeRegExpChar(char)
      continue
    }
    // Clase de caracteres: se busca el `]` de cierre saltando los casos en los que `]` es
    // literal (primer carácter de la clase, o justo después de la negación).
    let end = index
    if (pattern[end] === '!') end += 1
    if (pattern[end] === ']') end += 1
    while (end < pattern.length && pattern[end] !== ']') end += 1
    if (end >= pattern.length) {
      source += '\\['
      continue
    }
    let body = pattern.slice(index, end).replace(/\\/g, '\\\\')
    index = end + 1
    if (body.startsWith('!')) body = `^${body.slice(1)}`
    else if (body.startsWith('^')) body = `\\${body}`
    source += `[${body}]`
  }
  return new RegExp(`^${source}$`, 's')
}

/**
 * Réplica cliente de `export_spec.resolve_selection` para mostrar cuántos objetos matchea la
 * regla mientras se escribe. **No es autoritativa**: el plan real lo resuelve el backend contra
 * el catálogo en vivo, y además cierra dependencias (FK/trigger), que acá no se calculan.
 *
 * El orden es el mismo del servidor y no es intercambiable: tipos → modo/nombres → patrones de
 * inclusión → patrones de exclusión, y la exclusión GANA.
 */
export function resolveRuleSelection(
  objects: CloneObjectOut[],
  spec: CloneStructureSpec,
): CloneObjectOut[] {
  const types = new Set(spec.types)
  const candidates = objects.filter(
    (object) =>
      (types.size === 0 || types.has(object.object_type)) && !isGatewayInternalTable(object.name),
  )

  let selected: CloneObjectOut[]
  if (spec.mode === 'include') {
    const wanted = new Set(spec.names)
    selected = candidates.filter((object) => wanted.has(object.name))
  } else if (spec.mode === 'all_except') {
    const removed = new Set(spec.names)
    selected = candidates.filter((object) => !removed.has(object.name))
  } else {
    selected = candidates
  }

  if (spec.include_patterns.length > 0) {
    const includes = spec.include_patterns.map(globToRegExp)
    selected = selected.filter((object) => includes.some((re) => re.test(object.name)))
  }
  if (spec.exclude_patterns.length > 0) {
    const excludes = spec.exclude_patterns.map(globToRegExp)
    selected = selected.filter((object) => !excludes.some((re) => re.test(object.name)))
  }
  return selected
}

// ── Acciones masivas del modo manual ──────────────────────────────────────────────
// Todas operan solo sobre objetos PORTABLES (los no portables el backend los omite igual, así
// que marcarlos daría un conteo que el preview después desmiente) y **solo sobre los objetos
// que reciben**, partiendo de la selección actual. Esa segunda parte es la que importa cuando
// hay un filtro por tipo activo: «Todo» tiene que agregar lo visible, no descartar en silencio
// lo que el usuario ya había marcado en otro tipo de objeto.
export type BulkSelectionAction = 'all' | 'none' | 'invert'

export function applyBulkSelection(
  action: BulkSelectionAction,
  objects: CloneObjectOut[],
  selection: ReadonlyMap<string, CloneObjectRef>,
): Map<string, CloneObjectRef> {
  const next = new Map(selection)
  for (const object of objects) {
    if (!object.portable) continue
    const ref: CloneObjectRef = { object_type: object.object_type, name: object.name }
    const key = cloneRefKey(ref)
    if (action === 'all') next.set(key, ref)
    else if (action === 'none') next.delete(key)
    else if (next.has(key)) next.delete(key)
    else next.set(key, ref)
  }
  return next
}

/** Cuántos objetos de la lista se pueden marcar a mano (los no portables no cuentan). */
export function countSelectableObjects(objects: CloneObjectOut[]): number {
  return objects.reduce((total, object) => (object.portable ? total + 1 : total), 0)
}

/** Cuántos de la lista están marcados ahora mismo. */
export function countSelectedObjects(
  objects: CloneObjectOut[],
  selection: ReadonlyMap<string, CloneObjectRef>,
): number {
  return objects.reduce(
    (total, object) =>
      selection.has(cloneRefKey({ object_type: object.object_type, name: object.name }))
        ? total + 1
        : total,
    0,
  )
}
