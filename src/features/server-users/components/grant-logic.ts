import type { ApplyProfileBulkItem, GrantInfo, GrantLevel, ObjectRef } from '@/lib/contracts'
import { LEVELS_WITH_DATABASE, LEVELS_WITH_SCHEMA, LEVELS_WITH_TABLE } from './grant-object-levels'

/**
 * Lógica pura de la pantalla de otorgamiento (v21). Vive aparte del componente para poder
 * probarla sin montar React: son las cuatro reglas del contrato que más fácil se implementan mal.
 */

// ── El objeto destino, sin la base ──────────────────────────────────────────

/**
 * Lo que el formulario captura del objeto **sin la base de datos**: esa ya no se teclea, se
 * elige de la multiselección. De ahí que este borrador se reutilice tal cual para cada base
 * del lote — que es exactamente la semántica de plantilla del bulk (v21 §11).
 */
export interface GrantObjectDraft {
  schema: string
  table: string
  columns: string
  sequence: string
  routineKind: 'FUNCTION' | 'PROCEDURE'
  routineName: string
}

export const EMPTY_OBJECT_DRAFT: GrantObjectDraft = {
  schema: 'public',
  table: '',
  columns: '',
  sequence: '',
  routineKind: 'FUNCTION',
  routineName: '',
}

/**
 * Arma el `object_ref` de un nivel para UNA base (v21 §6). `database` se pasa aparte porque es
 * lo único que varía entre las bases del lote; el resto del borrador se reusa idéntico.
 *
 * `schema` solo se emite en PostgreSQL: en MySQL/MariaDB no existe el concepto y mandarlo
 * ensuciaría el cuerpo con un campo que el backend ignora.
 */
export function buildObjectRef(
  level: GrantLevel,
  draft: GrantObjectDraft,
  database: string | undefined,
  isPostgres: boolean,
): ObjectRef {
  const ref: ObjectRef = {}
  if (LEVELS_WITH_DATABASE.includes(level) && database?.trim()) ref.database = database.trim()
  if (isPostgres && LEVELS_WITH_SCHEMA.includes(level) && draft.schema.trim()) {
    ref.schema = draft.schema.trim()
  }
  if (LEVELS_WITH_TABLE.includes(level) && draft.table.trim()) ref.table = draft.table.trim()
  if (level === 'column') {
    const columns = draft.columns
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean)
    if (columns.length > 0) ref.columns = columns
  }
  if (level === 'sequence' && draft.sequence.trim()) ref.sequence = draft.sequence.trim()
  if (level === 'routine' && draft.routineName.trim()) {
    ref.routine = { kind: draft.routineKind, name: draft.routineName.trim() }
  }
  return ref
}

/** Un nivel `global` no cuelga de ninguna base: no hay nada que multiseleccionar. */
export function levelNeedsDatabase(level: GrantLevel): boolean {
  return level !== 'global'
}

// ── Privilegios sensibles (GATE, v21 §6) ────────────────────────────────────

/**
 * Tokens que el backend clasifica como **GATE**: se pueden otorgar, pero la operación audita la
 * intención antes de ejecutar (fail-closed).
 *
 * **La clasificación autoritativa vive en el backend y esta lista no la reemplaza**: el contrato
 * solo nombra dos (`ALL PRIVILEGES`, `GRANT OPTION`) y cierra con un etcétera. Los demás son los
 * clásicos de escalada de privilegios, incluidos acá para que la confirmación de la UI cubra los
 * casos evidentes. Que un token falte de esta lista no relaja nada del lado del motor: la
 * auditoría del backend corre igual.
 */
export const GATE_PRIVILEGE_TOKENS = [
  'ALL',
  'ALL PRIVILEGES',
  'GRANT OPTION',
  'SUPER',
  'CREATE USER',
  'CREATEROLE',
  'CREATEDB',
  'FILE',
  'SHUTDOWN',
  'RELOAD',
  'REPLICATION SLAVE',
  'REPLICATION CLIENT',
  'SET USER ID',
]

/**
 * Qué privilegios de la selección son sensibles. `with_grant_option: true` cuenta como GATE
 * aunque el privilegio no lo sea (§6), pero eso lo decide quien llama: acá solo se miran tokens.
 */
export function gatePrivilegesIn(privileges: string[]): string[] {
  const gate = new Set(GATE_PRIVILEGE_TOKENS)
  return privileges.filter((privilege) => gate.has(privilege.trim().toUpperCase()))
}

// ── Tandas del bulk (v21 §11) ───────────────────────────────────────────────

/** Tope duro del endpoint: `databases` acepta de 1 a 100 nombres. */
export const BULK_MAX_DATABASES = 100

/**
 * Tamaño de tanda recomendado por el contrato. No es cosmético: con `NullPool` cada
 * `can_grant` + `grant_object` abre **su propia conexión remota**, así que un lote de 100 bases
 * por N niveles puede abrir cientos de conexiones y retener un worker decenas de segundos. El
 * rate limit es 5/min, y 100 bases en tandas de 20 son exactamente 5 llamadas.
 */
export const BULK_CHUNK_SIZE = 20

/** Parte una lista en tandas de `size`. Con `size <= 0` devuelve la lista entera en una tanda. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return items.length > 0 ? [items] : []
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

// ── Acotar grants a una base (v21 §3) ───────────────────────────────────────

/**
 * Acota una lista de grants a UNA base de datos.
 *
 * Hace falta porque el contrato **no es simétrico entre motores**: en PostgreSQL el backend ya
 * devuelve solo la BD pedida, pero en MySQL/MariaDB **ignora** el parámetro `database` y responde
 * con los grants del usuario en todo el servidor. Mandar `database` y asumir que acotó es el
 * error fácil de este endpoint.
 *
 * El `object` de un grant es `"shop"`, `"shop.orders"` o `"shop.orders(email)"`: se compara el
 * primer segmento, sin comillas y sin distinguir mayúsculas. Los grants `global` (sin objeto) se
 * **conservan a propósito**: aplican a todas las bases, esta incluida, y esconderlos daría una
 * foto incompleta de lo que el usuario puede hacer ahí.
 */
export function filterGrantsByDatabase(grants: GrantInfo[], database: string): GrantInfo[] {
  const target = unquote(database.trim()).toLowerCase()
  if (!target) return grants
  return grants.filter((grant) => {
    if (grant.level === 'global' || !grant.object) return true
    return databaseOf(grant.object) === target
  })
}

function databaseOf(object: string): string {
  return unquote(object.split('.')[0] ?? '').toLowerCase()
}

function unquote(segment: string): string {
  return segment.replace(/^[`"[]/, '').replace(/[`"\]]$/, '')
}

// ── Qué le falta a un objeto para poder mandarse ────────────────────────────

/**
 * Campos que el nivel exige y el borrador no tiene todavía. Se usa para NO mandar mapeos
 * incompletos: un item de perfil a nivel `table` sin tabla no es un mapeo válido, y mandarlo
 * confiando en que el backend lo omita mezcla dos cosas distintas —«no lo mapeé» y «lo mapeé
 * mal»— dentro del mismo `skipped_levels` (v21 §9). Mejor decir de antemano qué falta.
 *
 * `database` no se comprueba acá: no se teclea, sale de la multiselección.
 */
export function missingObjectFields(level: GrantLevel, draft: GrantObjectDraft): string[] {
  const missing: string[] = []
  if (LEVELS_WITH_TABLE.includes(level) && !draft.table.trim()) missing.push('tabla')
  if (level === 'column' && draft.columns.split(',').every((column) => !column.trim())) {
    missing.push('columnas')
  }
  if (level === 'sequence' && !draft.sequence.trim()) missing.push('secuencia')
  if (level === 'routine' && !draft.routineName.trim()) missing.push('rutina')
  return missing
}

// ── Fan-out por base (v21 §12) ──────────────────────────────────────────────

/**
 * Un objeto destino del fan-out, ya resuelto por quien llama.
 *
 * El backend **no tiene** endpoint para otorgar un permiso suelto sobre N bases (v21 §12): son N
 * llamadas. Este tipo existe para que el bucle sea tonto —recibe cuerpos ya armados— y la
 * construcción del `object_ref` por base viva acá, donde se puede probar sin montar React.
 */
export interface GrantFanOutItem<TBody> {
  /** Cómo se nombra la unidad en el resultado: la base, o «(global)» si no cuelga de ninguna. */
  label: string
  body: TBody
}

/** Resultado de UNA unidad del fan-out. Un fallo nunca aborta las demás. */
export interface FanOutOutcome {
  label: string
  ok: boolean
  error?: string
}

// ── Normalización de resultados ─────────────────────────────────────────────

/**
 * Fila del panel de resultados. Las tres vías de otorgamiento —fan-out de privilegios sueltos,
 * bulk de perfil y perfil global— devuelven formas distintas; la pantalla muestra una sola tabla
 * porque al operador le importa lo mismo en los tres casos: en qué base funcionó y en cuál no.
 */
export interface GrantOutcomeRow {
  label: string
  ok: boolean
  /** Resumen corto de lo aplicado, cuando el endpoint lo reporta. */
  detail?: string
  skippedLevels?: string[]
  errors?: string[]
}

export function outcomeRowsFromFanOut(outcomes: FanOutOutcome[]): GrantOutcomeRow[] {
  return outcomes.map((outcome) => ({
    label: outcome.label,
    ok: outcome.ok,
    errors: outcome.error ? [outcome.error] : undefined,
  }))
}

/**
 * `ok` sale de `results[].ok` y **no** del status HTTP: el bulk responde 200 aunque todas las
 * bases hayan fallado (v21 §11).
 */
export function outcomeRowsFromBulk(results: ApplyProfileBulkItem[]): GrantOutcomeRow[] {
  return results.map((item) => ({
    label: item.database,
    ok: item.ok,
    detail: `${item.grants_applied} grant(s)`,
    skippedLevels: item.skipped_levels.length > 0 ? item.skipped_levels : undefined,
    errors: item.errors.length > 0 ? item.errors : undefined,
  }))
}
