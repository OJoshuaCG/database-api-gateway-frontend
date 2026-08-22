/**
 * Traducción de los códigos del módulo de entornos a texto accionable.
 *
 * Se clasifica **por `code`, nunca por la prosa del mensaje**. El precedente correcto es
 * `database-exports/messages.ts`, cuyo docstring ya fija el criterio; el contraejemplo es
 * `database-clones/wizard/messages.ts`, que reconoce fragmentos del mensaje con expresiones
 * regulares porque aquel backend no expone códigos. Entornos sí los expone (vocabulario cerrado
 * en `app/services/environment_catalog.py`), así que no hay excusa para volver a matchear prosa.
 *
 * DOS CANALES DISTINTOS, y conviene no confundirlos:
 *
 * 1. Los **422/409** llegan como `ApiError` y su código sale de `detail.public_context.code`.
 * 2. `apply-all` responde **200** con los ítems fallidos adentro: ahí el código viaja en
 *    `item.error_code`, en el cuerpo de éxito. Ningún extractor de `errors.ts` lo toca. Para eso
 *    está `describeItemRejection`.
 */

/** Códigos que el backend emite para este módulo. */
export const ENVIRONMENT_ERROR_CODES = [
  'environment.not_found',
  'environment.inactive',
  'environment.has_databases',
  'environment.name_taken',
  'environment.slug_taken',
  'environment.default_must_be_active',
  'environment.default_required',
  'environment.filter_conflict',
  'environment.confirmation_required',
  'environment.databases_outside_environment',
  'environment.destructive_blocked',
] as const
export type EnvironmentErrorCode = (typeof ENVIRONMENT_ERROR_CODES)[number]

const MESSAGES: Record<EnvironmentErrorCode, string> = {
  'environment.not_found': 'El entorno indicado no existe.',
  'environment.inactive': 'Ese entorno está inactivo y no se puede asignar.',
  'environment.has_databases':
    'El entorno todavía tiene bases de datos asignadas. Reasignalas antes de borrarlo, o desactivalo.',
  'environment.name_taken': 'Ya existe un entorno con ese nombre.',
  'environment.slug_taken': 'Ya existe un entorno con ese identificador.',
  'environment.default_must_be_active': 'Un entorno inactivo no puede ser el entorno por defecto.',
  'environment.default_required':
    'Tiene que quedar un entorno por defecto: si no, las bases nuevas nacerían sin clasificar.',
  'environment.filter_conflict':
    'No se puede filtrar por un entorno y por "sin clasificar" a la vez.',
  'environment.confirmation_required':
    'Este cambio debilita la política del entorno: hay que repetir su identificador para confirmarlo.',
  'environment.databases_outside_environment':
    'Alguna de las bases elegidas no pertenece al entorno indicado.',
  'environment.destructive_blocked':
    'El entorno bloquea las migraciones destructivas, así que la operación no se intentó.',
}

/** Traduce un código, o `null` si no es de este módulo (o si no viene ninguno). */
export function environmentMessage(code: string | null | undefined): string | null {
  if (!code) return null
  return MESSAGES[code as EnvironmentErrorCode] ?? null
}

/**
 * Cómo se pinta el resultado de UNA BD dentro de un `apply-all`.
 *
 * Tres estados, no dos, y la elección de tono es lo importante: **`blocked` va en `warning`, no
 * en `error`**. En esta app el rojo significa "esto está roto", y un rechazo por política es el
 * sistema FUNCIONANDO. Con 6 bloqueadas y 2 falladas, ocho filas rojas idénticas obligan a leer
 * ocho frases para saber cuáles necesitan acción.
 *
 * DIRECCIÓN DEL FALLBACK: un ítem con `ok: false` y SIN `error_code` —backend viejo, o un código
 * que este mapa no conoce— cae en **`failed`**, nunca en `blocked`. Ante la duda, la lectura más
 * grave: decir "no se intentó" sobre algo que sí se intentó sería peor que lo contrario.
 */
export type ItemOutcome = 'ok' | 'blocked' | 'failed'

export function classifyItem(item: {
  ok: boolean
  error_code?: string | null
}): ItemOutcome {
  if (item.ok) return 'ok'
  return item.error_code === 'environment.destructive_blocked' ? 'blocked' : 'failed'
}

export const OUTCOME_LABEL: Record<ItemOutcome, string> = {
  ok: 'Aplicada',
  blocked: 'Bloqueada',
  failed: 'Error',
}

export const OUTCOME_TONE: Record<ItemOutcome, 'success' | 'warning' | 'error'> = {
  ok: 'success',
  blocked: 'warning',
  failed: 'error',
}

/**
 * Texto del rechazo por política. Las palabras "no se intentó" son la carga útil: distinguen
 * "no pasó nada, por diseño" de "algo se rompió", que es una distinción que hoy no existe.
 *
 * NO se ofrece acción de reintento: `force` no es un override de esto. Las salidas reales son
 * reclasificar la base o separar las sentencias destructivas de la versión.
 */
export function describeItemRejection(item: {
  environment_slug?: string | null
  blocked_by?: string[]
}): string {
  const env = item.environment_slug ?? 'el entorno'
  const versions = item.blocked_by?.length
    ? ` Versiones frenadas: ${item.blocked_by.join(', ')}.`
    : ''
  return `No se intentó: no se ejecutó ningún DDL. ${env} bloquea las migraciones destructivas.${versions}`
}

/**
 * Etiqueta de una BD en el resultado del lote. `database_name` es `str | None` en el backend, y
 * React renderiza `null` como vacío sin que TypeScript avise (`ReactNode` lo acepta), así que
 * pasar por acá no es cosmético: una fila bloqueada o fallada **sin nombre es inaccionable**, y
 * el id siempre viene.
 */
export function databaseLabel(item: {
  managed_database_id: number
  database_name?: string | null
}): string {
  return item.database_name ?? `#${item.managed_database_id}`
}
