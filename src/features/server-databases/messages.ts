import type { ApiError } from '@/lib/api/errors'

/**
 * Clasificación de los errores del módulo a una ACCIÓN de recuperación concreta (§4.2, §4.5).
 *
 * El backend no expone un código de razón estructurado (todo llega como
 * `type: "AppHttpException"`), así que las variantes de un mismo status se reconocen por
 * fragmentos ESTABLES del `detail.msg` documentado. El `default` nunca rompe: si el texto no
 * calza con ningún patrón conocido se degrada a un error genérico y SIEMPRE se muestra el
 * `detail.msg` real — nunca se oculta información al admin.
 *
 * Los mensajes del mapeador de errores del motor (`map_driver_error`) son genéricos por diseño,
 * así que no se intenta deducir la causa de su texto más allá de lo documentado.
 */

// ── Creación (§3.1, §4.2) ───────────────────────────────────────────────────

export type CreateErrorField = 'name' | 'ownerId' | null

export interface CreateErrorInfo {
  /** Campo del formulario al que anclar el error; `null` = error de formulario. */
  field: CreateErrorField
  /** Texto de apoyo adicional bajo el mensaje del backend. */
  hint?: string
  /** El propietario ya no es válido: conviene recargar el selector. */
  reloadOwners?: boolean
  /** Error terminal: reintentar no puede ayudar. */
  terminal?: boolean
  /** Ofrecer [Reintentar] + [Probar conexión]. */
  retryable?: boolean
}

/**
 * Ancla un error de creación al campo correspondiente. Los 422 de `owner_id` no deberían
 * ocurrir si la validación en cliente funciona: si aparecen, son un bug de la UI.
 */
export function classifyCreateError(error: ApiError): CreateErrorInfo {
  const msg = error.message

  if (error.status === 403) {
    return {
      field: null,
      terminal: true,
      hint: 'La credencial del gateway no tiene permisos para crear bases en este servidor.',
    }
  }
  if (error.status === 429) {
    return {
      field: null,
      hint: 'Alcanzaste el límite de 10 creaciones por minuto. Esperá un momento.',
    }
  }
  if (error.status === 502 || error.status === 504) {
    return {
      field: null,
      retryable: true,
      hint: 'El resultado es incierto: volvé a la lista y actualizá antes de reintentar, por si la base sí se creó.',
    }
  }
  if (error.status === 409) {
    if (/sistema/i.test(msg)) return { field: 'name' }
    if (/propietario/i.test(msg)) return { field: 'ownerId', reloadOwners: true }
    if (/ya existe/i.test(msg)) {
      return {
        field: 'name',
        hint: 'Puede existir en el motor aunque no aparezca en el inventario del gateway.',
      }
    }
    return { field: 'name' }
  }
  if (error.status === 422) {
    if (/owner_id/i.test(msg)) return { field: 'ownerId' }
    if (/propietario|server_user/i.test(msg)) return { field: 'ownerId', reloadOwners: true }
    return { field: 'name' }
  }
  return { field: null }
}

/**
 * Pista específica del 500 más frecuente en PostgreSQL: un locale que no existe en el SO del
 * servidor produce `invalid locale name` (SQLSTATE 22023), que no está mapeado y llega como 500
 * genérico en vez de como error de validación. Ver [SUPUESTO S1] del plan.
 */
export function localeHint(
  error: ApiError,
  isPostgres: boolean,
  sentCollation: boolean,
): string | undefined {
  if (error.status !== 500 || !isPostgres || !sentCollation) return undefined
  return 'Si especificaste un locale, verificá que exista en el servidor PostgreSQL: un locale inexistente llega como error interno, no como error de validación.'
}

/**
 * Aviso obligatorio cuando la creación falla con el interruptor de inventario encendido: el
 * flujo del inventario inserta la fila con `status=pending` ANTES de tocar el motor, así que un
 * fallo deja un registro en estado `error` que hay que revisar a mano (§3.1).
 */
export const REGISTER_LEFTOVER_WARNING =
  'El registro en el inventario pudo quedar creado en estado «error». Revisá las bases gestionadas del servidor.'

// ── Borrado (§3.2, §3.3, §4.5) ──────────────────────────────────────────────

export type DropErrorAction =
  /** El token venció: rehacer el preview conservando lo que el admin escribió. */
  | 'expiredToken'
  /** El token es inválido o de otra BD: rehacer el preview, nunca reutilizarlo. */
  | 'invalidToken'
  /** El nombre transcrito no coincide: error bajo el campo de texto. */
  | 'nameMismatch'
  /** PostgreSQL rechazó el DROP por sesiones abiertas: rehacer el preview con la casilla marcada. */
  | 'needsForceDisconnect'
  /** La base ya no existe: resultado aceptable, no un fallo. */
  | 'alreadyGone'
  /** Estado terminal (BD de sistema, sin permisos): no hay reintento útil. */
  | 'terminal'
  /** Límite de 3/min alcanzado: espera visible, jamás reintento automático. */
  | 'rateLimited'
  /** ⚠️ El borrado PUDO ejecutarse: solo se ofrece comprobar estado. */
  | 'uncertain'
  /** Fallo genérico: comprobar estado refrescando la lista de bases. */
  | 'checkStatus'

export function classifyDropError(error: ApiError): DropErrorAction {
  const msg = error.message

  if (error.status === 410) return 'expiredToken'
  if (error.status === 429) return 'rateLimited'
  if (error.status === 403) return 'terminal'
  if (error.status === 404) return 'alreadyGone'
  if (error.status === 502 || error.status === 504) return 'uncertain'
  if (error.status === 409) {
    return /sistema/i.test(msg) ? 'terminal' : 'needsForceDisconnect'
  }
  if (error.status === 422) {
    if (/confirm_target_name|no coincide con el nombre/i.test(msg)) return 'nameMismatch'
    return 'invalidToken'
  }
  return 'checkStatus'
}

/** Texto de apoyo bajo el mensaje del backend, por acción de recuperación. */
export const DROP_ACTION_HINTS: Partial<Record<DropErrorAction, string>> = {
  expiredToken:
    'La confirmación caducó (es válida por 2 minutos). Volvé a comprobar la base de datos para continuar; se conserva lo que ya escribiste.',
  invalidToken:
    'El token de confirmación no es válido para esta base de datos. Hay que rehacer la comprobación.',
  nameMismatch:
    'El nombre transcrito no coincide exactamente con el de la base de datos. Usá el botón de copiar para evitar caracteres ambiguos.',
  needsForceDisconnect:
    'PostgreSQL rechazó el borrado porque hay sesiones abiertas contra la base. Volvé a comprobar y marcá «terminar las conexiones activas».',
  alreadyGone: 'La base de datos ya no existía en el servidor.',
  rateLimited: 'Alcanzaste el límite de 3 borrados por minuto. Esperá antes de reintentar.',
  uncertain:
    'No se recibió respuesta del servidor. El borrado PUDO haberse ejecutado: no se reintenta automáticamente. Comprobá el estado de la lista de bases.',
  checkStatus:
    'Comprobá el estado de la lista de bases: es la única forma fiable de saber si la base sigue ahí.',
}

/** Etiqueta del botón de recuperación; `null` cuando la acción no ofrece ninguno. */
export const DROP_ACTION_LABELS: Record<DropErrorAction, string | null> = {
  expiredToken: 'Volver a comprobar',
  invalidToken: 'Volver a comprobar',
  nameMismatch: null,
  needsForceDisconnect: 'Volver a comprobar y terminar conexiones',
  alreadyGone: null,
  terminal: null,
  rateLimited: null,
  uncertain: 'Comprobar estado',
  checkStatus: 'Comprobar estado',
}

/**
 * La auditoría del borrado es *fail-closed*: si no se pudo persistir la intención, el backend
 * aborta ANTES de tocar el motor y responde 500. Solo se afirma que no se borró nada si el
 * mensaje del backend lo indica; en caso contrario el estado es desconocido.
 */
export function isAuditFailure(error: ApiError): boolean {
  return error.status === 500 && /auditor[íi]a/i.test(error.message)
}

// ── Preview, paso 1 (§4.4) ──────────────────────────────────────────────────

export type PreviewErrorAction = 'alreadyGone' | 'terminal' | 'rateLimited' | 'retry'

export function classifyPreviewError(error: ApiError): PreviewErrorAction {
  if (error.status === 404) return 'alreadyGone'
  if (error.status === 409) return 'terminal'
  if (error.status === 429) return 'rateLimited'
  return 'retry'
}

export const PREVIEW_ACTION_HINTS: Record<PreviewErrorAction, string> = {
  alreadyGone: 'Esta base de datos ya no existe en el servidor.',
  terminal: 'No se puede eliminar una base de datos del sistema.',
  rateLimited: 'Demasiados intentos; esperá un momento antes de volver a comprobar.',
  retry: 'No se pudo comprobar la base de datos en el motor.',
}
