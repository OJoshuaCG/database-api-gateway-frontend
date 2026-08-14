import type {
  CollationConversionExecuteIn,
  CollationConversionItemOut,
  CollationConversionPreviewIn,
  CollationObjectOut,
  CollationObjectRef,
  CollationTableOut,
  ConversionMode,
  EngineType,
  FrozenObjectType,
} from '@/lib/contracts'

/**
 * Lógica pura del asistente de conversión de collation (`collation-conversions`). Sin React ni
 * red: resolución de modo por motor, construcción de los cuerpos de `preview`/`execute`,
 * toggles inmutables de selección y los helpers de preselección/clasificación de resultado que
 * usa el hook central. Todo aquí es testeable en aislamiento (ver `logic.test.ts`).
 */

const FROZEN_OBJECT_TYPES: readonly FrozenObjectType[] = [
  'procedure',
  'function',
  'trigger',
  'event',
  'view',
]

/** Angosta el `object_type: string` del inventario a los 5 tipos congelados del plan. */
export function isFrozenObjectType(value: string): value is FrozenObjectType {
  return (FROZEN_OBJECT_TYPES as readonly string[]).includes(value)
}

// ── Modo por motor (Paso 1, sin plan todavía) ──────────────────────────────────
/**
 * `mode` que la UI asume ANTES de crear el plan, para adaptar el formulario del Paso 1
 * (PostgreSQL no soporta charset por objeto: se reconstruye por columna). Una vez que existe un
 * job, la fuente de verdad pasa a ser el `mode` que devuelve cada respuesta del backend — esta
 * función deja de consultarse.
 */
export function modeForEngine(engine: EngineType): ConversionMode {
  return engine === 'postgresql' ? 'columns' : 'universal'
}

// ── Selección ──────────────────────────────────────────────────────────────────
/** Clave del `Map` de objetos seleccionados: los nombres pueden repetirse entre tipos distintos. */
export function objectKey(ref: CollationObjectRef): string {
  return `${ref.object_type}::${ref.name}`
}

/** Toggle inmutable simple sobre el `Set` de tablas marcadas. */
export function toggleTableSelection(selected: ReadonlySet<string>, name: string): Set<string> {
  const next = new Set(selected)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return next
}

/** Toggle inmutable sobre el `Map` de objetos marcados, clave = `objectKey`. */
export function toggleObjectSelection(
  selected: ReadonlyMap<string, CollationObjectRef>,
  ref: CollationObjectRef,
): Map<string, CollationObjectRef> {
  const next = new Map(selected)
  const key = objectKey(ref)
  if (next.has(key)) next.delete(key)
  else next.set(key, ref)
  return next
}

/** Preselecciona las tablas que necesitan conversión (§9.1: preseleccionar por defecto). */
export function preselectTables(tables: readonly CollationTableOut[]): Set<string> {
  const selected = new Set<string>()
  for (const table of tables) {
    if (table.needs_conversion) selected.add(table.name)
  }
  return selected
}

/** Preselecciona los objetos programables desactualizados (`is_outdated: true`). */
export function preselectObjects(
  objects: readonly CollationObjectOut[],
): Map<string, CollationObjectRef> {
  const selected = new Map<string, CollationObjectRef>()
  for (const object of objects) {
    if (!object.is_outdated) continue
    if (!isFrozenObjectType(object.object_type)) continue
    const ref: CollationObjectRef = { object_type: object.object_type, name: object.name }
    selected.set(objectKey(ref), ref)
  }
  return selected
}

// ── Construcción de bodies ──────────────────────────────────────────────────────
export function buildPreviewBody(params: {
  checkedTables: ReadonlySet<string>
  checkedObjects: ReadonlyMap<string, CollationObjectRef>
  includeDatabaseDefault: boolean
  mode: ConversionMode
  force: boolean
}): CollationConversionPreviewIn {
  const { checkedTables, checkedObjects, includeDatabaseDefault, mode, force } = params
  return {
    tables: [...checkedTables],
    // El selector de objetos ni se muestra en modo `columns`: se manda vacío siempre, aunque
    // `checkedObjects` tuviera algo de una selección previa a un cambio de motor/modo.
    objects: mode === 'columns' ? [] : [...checkedObjects.values()],
    // Se fuerza también en cliente (no solo confiar en que el backend lo fuerce): `columns` no
    // tiene un `ALTER DATABASE` universal que aplicar por defecto.
    include_database_default: mode === 'columns' ? false : includeDatabaseDefault,
    force,
  }
}

export function buildExecuteBody(params: {
  confirmTargetName: string
  confirmToken: string
  force: boolean
}): CollationConversionExecuteIn {
  return {
    confirm_target_name: params.confirmTargetName,
    confirm_token: params.confirmToken,
    force: params.force,
  }
}

// ── Clasificación de resultado (§4/§5 del doc) ──────────────────────────────────
/**
 * `true` si el único paso del plan era el `ALTER DATABASE` y falló (§5.4): ninguna tabla ni
 * objeto llegó a tocarse, así que la base NO fue modificada.
 */
export function isSingleDatabaseAlterFailure(
  items: readonly CollationConversionItemOut[],
): boolean {
  return items.length === 1 && items[0]!.object_type === 'database' && items[0]!.status === 'error'
}

/** Fragmento estable del peor caso del módulo (§4.7): el DROP se aplicó y el CREATE no. */
const DROP_WITHOUT_CREATE_PATTERN = /el drop se aplic[oó] y el create no/i

/** `true` si el objeto desapareció del motor: se aplicó el DROP pero el CREATE de vuelta falló. */
export function isDropWithoutCreateFailure(error: string | null | undefined): boolean {
  if (!error) return false
  return DROP_WITHOUT_CREATE_PATTERN.test(error)
}

/**
 * Distingue el `skipped` de "rutina con grants ilegibles, sigue rota" del `skipped` inocuo de
 * "ya estaba al día"/"ya no existe" (§4.8): la presencia de `grants_error` es la única señal.
 */
export function isFailedGrantsSkip(
  item: Pick<CollationConversionItemOut, 'status' | 'grants_error'>,
): boolean {
  return item.status === 'skipped' && item.grants_error != null
}
