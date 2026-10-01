import type { ApiError } from '@/lib/api/errors'

/**
 * Copy del 409 `engine_database.scope_not_allowed`: la base elegida como origen o destino es una
 * base de SISTEMA del motor (`mysql`, `sys`, `information_schema`, `performance_schema`; en
 * PostgreSQL `postgres` y los templates) o la PROPIA base de metadatos del gateway.
 *
 * Lo emiten tres módulos que antes no aplicaban el guard —snapshot, blueprint desde snapshot y
 * comparación de esquemas (crear, preview, adoptar y ejecutar)—, así que el texto vive acá, junto
 * al resto de lo que la UI sabe de las bases del motor, y no copiado en cada asistente.
 *
 * `public_context` trae `reason` y `side`, pero NO el nombre de la base: ese viaja en `context`,
 * que el backend solo expone en desarrollo. Por eso el llamador puede pasar los nombres que ya
 * conoce por lado, y si ninguno está, se usa el `msg` del backend (que sí lo nombra).
 */
export const ENGINE_DATABASE_SCOPE_NOT_ALLOWED = 'engine_database.scope_not_allowed'

export const SYSTEM_DATABASE_FALLBACK =
  'Esa base de datos es una base de datos de sistema del motor: no se puede usar como origen ni como destino de esta operación.'

export const GATEWAY_METADATA_MESSAGE =
  'Esa base de datos es la propia base de metadatos del gateway: no se puede usar como origen ni como destino de esta operación.'

/** Motivo ausente o desconocido: vale para los dos casos sin afirmar cuál es. */
const SCOPE_FALLBACK =
  'Esa base de datos no se puede usar como origen ni como destino de esta operación: es una base de sistema del motor o la base de metadatos del gateway.'

const SIDE_HINT: Record<string, string> = {
  source: 'Revisa la base de origen.',
  target: 'Revisa la base de destino.',
}

/** Nombres que el llamador ya conoce, por lado del pedido. */
export interface ScopeDatabaseNames {
  source?: string | null
  target?: string | null
}

function systemDatabaseMessage(name: string): string {
  return `'${name}' es una base de datos de sistema del motor: no se puede usar como origen ni como destino de esta operación.`
}

/**
 * Mensaje del 409, o `null` si el error es otro, para que el llamador caiga en `apiError.message`
 * y nunca oculte información.
 *
 * Con `side` conocido se suma qué lado revisar: en la comparación de esquemas el operador eligió
 * dos bases y el texto del backend («ni como origen ni como destino») no dice cuál falló.
 */
export function engineDatabaseScopeMessage(
  error: ApiError,
  names: ScopeDatabaseNames = {},
): string | null {
  if (error.code !== ENGINE_DATABASE_SCOPE_NOT_ALLOWED) return null
  const context = error.guardContext
  const side = context?.side
  const sideHint = side ? SIDE_HINT[side] : undefined

  let base: string
  switch (context?.reason) {
    case 'system_database': {
      const known = side === 'source' || side === 'target' ? names[side] : undefined
      const name = context.databaseName ?? known ?? undefined
      // Sin nombre, el `msg` del backend es mejor que el genérico: es el único que lo nombra.
      // `type` presente = el cuerpo era el envelope del backend, no el texto por defecto del status.
      base = name
        ? systemDatabaseMessage(name)
        : error.type
          ? error.message
          : SYSTEM_DATABASE_FALLBACK
      break
    }
    case 'gateway_metadata':
      base = GATEWAY_METADATA_MESSAGE
      break
    default:
      base = SCOPE_FALLBACK
  }
  return sideHint ? `${base} ${sideHint}` : base
}

/** ¿Es este rechazo? Para que un 409 de alcance no se lea como el 409 propio del formulario. */
export function isEngineDatabaseScopeError(error: ApiError | null | undefined): boolean {
  return error?.code === ENGINE_DATABASE_SCOPE_NOT_ALLOWED
}
