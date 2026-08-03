import { type ApiError } from '@/lib/api/errors'

/**
 * Clasificación de errores de la Consola SQL y mapeo de los códigos de motivo a la pantalla
 * del gateway que SÍ hace esa operación (`api-reference-v6.md` §8 y §9.2).
 *
 * La distinción que gobierna todo el módulo está una capa más arriba: el rechazo del motor
 * NO llega por aquí (es HTTP 200 con `success: false`). Todo lo que se clasifica en este
 * archivo son fallos reales de la API.
 */

export type QueryErrorAction =
  /** 410, o 422 de token que no corresponde: se re-pide el preview de forma transparente. */
  | 'retryPreview'
  /** 403 de política: no se reintenta nunca, se enlaza al módulo correcto. */
  | 'blockedByPolicy'
  /** 403 por escribir sobre una BD de sistema — el preview no lo detecta, solo el execute. */
  | 'systemDatabase'
  /** 404: el usuario no está en el inventario. Salida: cambiar a `provided`. */
  | 'storedUserMissing'
  /** 409: está en el inventario pero el gateway nunca fijó su contraseña. Misma salida. */
  | 'storedUserNoPassword'
  /** 409: el destino es la propia base de metadatos del gateway. Sin salida, por diseño. */
  | 'gatewayMetadata'
  /** 422: `impersonate` pedido contra MySQL/MariaDB. */
  | 'impersonateUnsupported'
  /** 422: el nombre tipeado no coincide con la base. No debería pasar (la UI ya lo valida). */
  | 'nameMismatch'
  /** 422: SQL vacío o por encima del tope de bytes. */
  | 'sqlTooLarge'
  /** 422 restantes: falta un campo del modo de conexión. */
  | 'invalidRequest'
  | 'rateLimited'
  /** 502/504: el servidor destino no responde. Error de sistema de verdad. */
  | 'engineUnreachable'
  | 'terminal'

/** Código de motivo que solo emite el execute; el preview no puede verlo. */
const SYSTEM_DATABASE_CODE = 'system_database_write'

export function classifyQueryError(error: ApiError): QueryErrorAction {
  if (error.status === 410) return 'retryPreview'

  if (error.status === 403) {
    const isSystemDatabase = error.reasons?.some((reason) => reason.code === SYSTEM_DATABASE_CODE)
    return isSystemDatabase ? 'systemDatabase' : 'blockedByPolicy'
  }

  if (error.status === 404) return 'storedUserMissing'

  if (error.status === 409) {
    // Dos 409 muy distintos: uno tiene salida (cambiar de modo), el otro es un muro.
    return /metadatos/i.test(error.message) ? 'gatewayMetadata' : 'storedUserNoPassword'
  }

  if (error.status === 422) {
    if (/confirm_target_name/i.test(error.message)) return 'nameMismatch'
    // El caso que más se ve en producción: el token dejó de corresponder porque cambió algo.
    if (/confirm_token|token de confirmación/i.test(error.message)) return 'retryPreview'
    if (/impersonaci|SET ROLE/i.test(error.message)) return 'impersonateUnsupported'
    if (/tope de|bytes/i.test(error.message)) return 'sqlTooLarge'
    return 'invalidRequest'
  }

  if (error.status === 429) return 'rateLimited'
  if (error.isEngineError) return 'engineUnreachable'
  return 'terminal'
}

/** El 410 y el 422 de token se recuperan solos: re-pedir el preview y reabrir la confirmación. */
export function isAutoRecoverable(action: QueryErrorAction): boolean {
  return action === 'retryPreview'
}

/**
 * Solo estas dos situaciones son errores de sistema: rojo, `request_id` visible y botón de
 * reintentar. Todo lo demás es una condición del flujo con su propia salida.
 */
export function isSystemFailure(action: QueryErrorAction): boolean {
  return action === 'engineUnreachable' || action === 'terminal'
}

/** El modo `stored` no sirvió; la salida es reintentar con la contraseña a mano. */
export function suggestsProvidedMode(action: QueryErrorAction): boolean {
  return action === 'storedUserMissing' || action === 'storedUserNoPassword'
}

/**
 * Pista accionable que acompaña al `msg` del backend. El backend ya redacta bien el qué; lo
 * que falta siempre es el "y ahora qué hago".
 */
export const QUERY_ACTION_HINTS: Record<QueryErrorAction, string> = {
  retryPreview:
    'La confirmación caducó o dejó de corresponder. Se vuelve a clasificar la consulta y se pide la confirmación otra vez.',
  blockedByPolicy:
    'La política de la consola no ejecuta esto ni con confirmación. Hay un módulo del gateway que sí hace esta operación.',
  systemDatabase:
    'Modificar una base de datos de sistema corrompería el propio servidor. Leerlas sí está permitido.',
  storedUserMissing:
    'Ese usuario no está en el inventario del gateway, así que no hay contraseña almacenada. Probalo con la contraseña a mano.',
  storedUserNoPassword:
    'El usuario está en el inventario pero el gateway nunca fijó su contraseña: el motor solo guarda un hash irreversible. Probalo con la contraseña a mano.',
  gatewayMetadata:
    'Es un bloqueo por diseño y no tiene salida: operar sobre la base de metadatos se llevaría el inventario, la auditoría y las credenciales de todos los servidores.',
  impersonateUnsupported:
    'Adoptar un rol solo existe en PostgreSQL. En MySQL/MariaDB elegí el usuario con su contraseña.',
  nameMismatch:
    'El nombre escrito debe coincidir exactamente con el de la base, incluidas mayúsculas.',
  sqlTooLarge: 'Recortá la consulta o dividila en varios lotes.',
  invalidRequest: 'Revisá los datos de la identidad antes de volver a intentar.',
  rateLimited: 'Esperá unos segundos: el límite es de 30 consultas por minuto.',
  engineUnreachable:
    'No se pudo llegar al servidor de base de datos destino, o la operación excedió el tiempo de espera.',
  terminal: 'Volvé a intentarlo. Si persiste, pasale el identificador de la petición a soporte.',
}

// ── Motivos → módulo del gateway que sí hace esa operación (§8.1, §10.3) ──────

export interface ReasonLink {
  to: string
  label: string
}

/**
 * Un bloqueo sin salida es frustrante; con enlace, es una redirección útil. Solo se mapean
 * los códigos cuyo mensaje menciona un endpoint dedicado del gateway: inventar un destino
 * para el resto confundiría más de lo que ayuda.
 */
export function reasonLink(code: string, serverId: number): ReasonLink | null {
  switch (code) {
    case 'dcl_grant_revoke':
      return { to: '/server-users', label: 'Ir a Usuarios y permisos' }
    case 'dcl_user_role':
      return { to: `/servers/${serverId}?tab=users`, label: 'Ir a Usuarios del motor' }
    case 'database_lifecycle':
      return { to: `/servers/${serverId}?tab=databases`, label: 'Ir a Bases de datos' }
    case 'copy_statement':
      return { to: '/database-clones', label: 'Ir a Clonado de bases' }
    default:
      return null
  }
}

/**
 * Ayuda de fondo del nivel `blocked`. La razón es una sola y conviene decirla entera: no
 * están prohibidas porque el motor las rechace —el gateway conecta con una credencial
 * pseudo-root, así que el motor SÍ las permitiría—, sino porque el gateway decide no
 * ofrecerlas nunca desde acá.
 */
export const BLOCKED_RATIONALE =
  'El gateway conecta con una credencial pseudo-root: el motor permitiría estas operaciones. Están prohibidas desde la consola por política, y varias tienen un módulo propio en el gateway con sus propios guards y auditoría.'
