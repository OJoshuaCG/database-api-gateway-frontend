import {
  ACCESS_FORBIDDEN_CODE,
  AUTH_CSRF_ERROR_CODES,
  AUTH_PASSWORD_ERROR_CODES,
  AUTH_SESSION_ERROR_CODES,
  AUTH_STEP_UP_ERROR_CODES,
  GATEWAY_USER_ERROR_CODES,
  SCOPE_HAS_GRANTS_CODE,
} from '@/lib/contracts'
import { ApiError, toApiError } from '@/lib/api/errors'

/**
 * Copy de los finales de sesión y de los rechazos de CSRF (api-reference-v23 §7.1 y §7.3).
 *
 * **La sesión ahora vence de verdad**, y ése es el cambio de comportamiento que más va a sorprender:
 * antes no expiraba nunca mientras hubiera actividad. Ahora hay dos relojes —12 h absolutas desde
 * el login y 60 min de inactividad— y el 401 dice cuál se cumplió. Decirlo importa: «expiró por
 * inactividad» invita a volver a entrar, mientras que «alcanzó su duración máxima» explica por qué
 * lo echó **mientras estaba trabajando**, que sin explicación se lee como un bug.
 */

/** Motivo del cierre, listo para mostrar en el login. */
export interface SessionEndReason {
  code: string
  title: string
  detail: string
}

const SESSION_END_COPY: Record<string, { title: string; detail: string }> = {
  [AUTH_SESSION_ERROR_CODES.absolute]: {
    title: 'Tu sesión alcanzó su duración máxima',
    detail:
      'Las sesiones duran 12 horas desde que iniciás, haya habido actividad o no. Volvé a entrar para continuar.',
  },
  [AUTH_SESSION_ERROR_CODES.idle]: {
    title: 'Tu sesión expiró por inactividad',
    detail: 'Pasaron más de 60 minutos sin actividad.',
  },
  [AUTH_SESSION_ERROR_CODES.logout]: {
    title: 'La sesión se cerró',
    detail: 'Se cerró desde esta u otra pestaña.',
  },
  [AUTH_SESSION_ERROR_CODES.passwordChange]: {
    title: 'Tu contraseña cambió',
    detail: 'Cambiar la contraseña cierra todas las sesiones abiertas. Entrá con la nueva.',
  },
  [AUTH_SESSION_ERROR_CODES.roleChange]: {
    title: 'Tus permisos cambiaron',
    detail:
      'Alguien modificó tu rol o tus accesos, y eso cierra las sesiones abiertas para que los cambios tengan efecto.',
  },
  [AUTH_SESSION_ERROR_CODES.adminRevoked]: {
    title: 'Tu sesión fue revocada',
    detail: 'Un administrador la cerró, o se desactivó la cuenta.',
  },
  [AUTH_SESSION_ERROR_CODES.stepUpFailed]: {
    title: 'Se cerró la sesión por seguridad',
    detail: 'La contraseña se confirmó mal cinco veces seguidas. Volvé a entrar para continuar.',
  },
  // `unknown` y `missing` son «no hay sesión»: el login normal, sin nada que explicar. No se
  // mapean a propósito — mostrar un aviso ahí convertiría el arranque limpio de la app en un
  // error aparente.
}

/**
 * Traduce un 401 al motivo por el que terminó la sesión, o `null` si no hay nada que contar
 * (nunca hubo sesión, o el backend no mandó código).
 *
 * Devolver `null` en vez de un genérico es deliberado: un cartel de «tu sesión terminó» en la
 * primera visita de alguien que nunca entró es ruido que entrena a ignorar el cartel cuando sí
 * importa.
 */
export function sessionEndReason(error: ApiError): SessionEndReason | null {
  if (error.status !== 401 || !error.code) return null
  const copy = SESSION_END_COPY[error.code]
  return copy ? { code: error.code, ...copy } : null
}

/**
 * Copy de un 403 de CSRF (§7.1).
 *
 * Estos tres son **fallos del cliente, no del usuario**: significan que la SPA no mandó el header,
 * que mandó uno viejo, o que el origen no es el esperado. No hay nada que el operador pueda
 * arreglar tipeando, así que el copy manda a recargar —que es lo que efectivamente lo resuelve,
 * porque el middleware repone la cookie en cualquier respuesta con sesión— y se registra en consola
 * para que quede rastro del bug.
 */
export function csrfErrorCopy(error: ApiError): string | null {
  switch (error.code) {
    case AUTH_CSRF_ERROR_CODES.missing:
    case AUTH_CSRF_ERROR_CODES.invalid:
      return 'La credencial de seguridad del formulario no es válida. Recargá la página e intentá de nuevo; si iniciaste sesión en otra pestaña, esta quedó con la anterior.'
    case AUTH_CSRF_ERROR_CODES.originRejected:
      return 'El navegador envió la solicitud desde un origen que el gateway no reconoce. Verificá que estés usando la dirección oficial de la aplicación.'
    default:
      return null
  }
}

/**
 * Título del aviso de un rechazo de CSRF. Dice qué pasó sin hablar de permisos: un 403 de CSRF
 * comparte status con `access.forbidden`, pero confundirlos manda a la persona a pedir un acceso
 * que ya tiene, cuando la salida real es recargar la página.
 */
export const CSRF_ERROR_TITLE = 'La solicitud no pasó la verificación de seguridad'

/**
 * ¿Este error es un rechazo de CSRF? Acepta `unknown` como `isAccessForbidden`, para usarse igual
 * desde un `onError`. Se reconoce por el código, que es lo único que lo distingue del 403 de
 * autorización.
 */
export function isCsrfError(error: unknown): boolean {
  if (error === null || error === undefined) return false
  const apiError = error instanceof ApiError ? error : toApiError(error)
  return csrfErrorCopy(apiError) !== null
}

// ── 403 de autorización (§3) ───────────────────────────────────────────────────

/** Adónde manda el 403: la persona ve ahí qué incluye su acceso. */
export const MY_ACCESS_PATH = '/mi-cuenta'

/** La sección «Contraseña» de «Mi cuenta»: el único lugar donde alguien cambia la suya. */
export const MY_PASSWORD_PATH = '/mi-cuenta?tab=contrasena'

export interface ForbiddenCopy {
  title: string
  body: string
  actionLabel: string
  actionTo: string
}

/**
 * Copy compartido de un 403 `access.forbidden`. Es UNO para toda la app a propósito: el backend
 * no dice qué capacidad faltó —para no regalar un mapa de la superficie por fuerza bruta—, así
 * que la pantalla tampoco puede, y lo único útil es mandar a ver el propio acceso.
 *
 * Nunca se ofrece «Reintentar»: el mismo request con el mismo acceso da el mismo 403. La salida
 * real es pedir acceso, o recargar si se lo cambiaron hace poco.
 */
export function forbiddenCopy(): ForbiddenCopy {
  return {
    title: 'No tenés acceso a esta acción',
    body: 'Tu acceso actual no la incluye en este destino. Revisá «Mi acceso» para ver qué podés hacer, o pedíselo a quien administra los accesos. Si te cambiaron los permisos hace poco, recargá la página.',
    actionLabel: 'Ver mi acceso',
    actionTo: MY_ACCESS_PATH,
  }
}

/**
 * ¿Es el 403 de autorización del gateway? Se reconoce por el código y no solo por el status: un
 * 403 de CSRF significa otra cosa (un fallo del cliente, que se arregla recargando) y varios
 * módulos tienen 403 propios sin código —la política de la consola SQL, la base de sistema— que
 * tampoco son esto.
 */
export function isAccessForbidden(error: unknown): boolean {
  if (error === null || error === undefined) return false
  const apiError = error instanceof ApiError ? error : toApiError(error)
  return apiError.status === 403 && apiError.code === ACCESS_FORBIDDEN_CODE
}

/**
 * Una base que un lote omitió por falta de alcance (`error_code: access.forbidden`). El backend
 * devuelve SOLO el id —ni nombre, ni servidor, ni entorno— para no filtrar lo que el actor no
 * puede tocar, así que el id es todo lo que hay para mostrar.
 */
export function skippedBaseLabel(id: number): string {
  return `Sin permiso en esta base (#${id})`
}

/** ¿Es un ítem de lote omitido por la capa 2? Solo `ok: false` con el código de autorización. */
export function isSkippedByScope(item: { ok: boolean; error_code?: string | null }): boolean {
  return !item.ok && item.error_code === ACCESS_FORBIDDEN_CODE
}

/** El motivo de un ítem omitido: no se intentó nada, y la salida es pedir el acceso. */
export const SKIPPED_BY_SCOPE_REASON =
  'No se intentó: tu acceso no alcanza el entorno de este destino.'

// ── Step-up: confirmar la contraseña (`POST /auth/step-up`) ──────────────────

/** El porqué del pedido, en una línea. La ventana dura `STEP_UP_TTL_SECONDS` (300 s). */
export const STEP_UP_EXPLANATION =
  'Por seguridad, confirmá tu contraseña para continuar. Vale 5 minutos.'

/**
 * ¿Es el 403 de «falta confirmar la contraseña»? Solo llega hasta una pantalla cuando la persona
 * canceló el pedido (o el reenvío volvió a darlo): en el resto de los casos `runRequest` lo resuelve.
 */
export function isStepUpRequired(error: unknown): boolean {
  if (error === null || error === undefined) return false
  const apiError = error instanceof ApiError ? error : toApiError(error)
  return apiError.status === 403 && apiError.code === AUTH_STEP_UP_ERROR_CODES.required
}

/** Copy del 403 `access.step_up_required` que llegó a la pantalla: no se ejecutó nada. */
export const STEP_UP_REQUIRED_COPY = {
  title: 'Falta confirmar tu contraseña',
  body: 'La acción no se ejecutó. Volvé a intentarla y confirmá tu contraseña cuando se te pida.',
} as const

/**
 * Traduce un error de `POST /auth/step-up` al mensaje del diálogo.
 *
 * El 401 (`auth.session_step_up_failed`, o cualquier sesión muerta) no llega con sentido acá: lo
 * atiende el handler global y el diálogo se cierra con él.
 */
export function stepUpErrorMessage(error: ApiError): string {
  if (error.status === 429) {
    return 'Hiciste demasiados intentos. Esperá un minuto y volvé a probar.'
  }
  if (error.code === AUTH_STEP_UP_ERROR_CODES.failed) {
    // `attempts_remaining` = 5 − fallos seguidos: con 1, el próximo error ya revoca la sesión.
    const left = error.attemptsRemaining
    if (left === undefined) return 'La contraseña no es correcta.'
    if (left <= 1) {
      return 'La contraseña no es correcta. Es tu último intento: si fallás, se cierra la sesión.'
    }
    return `La contraseña no es correcta. Te quedan ${left} intentos; si fallan todos, se cierra la sesión.`
  }
  const csrf = csrfErrorCopy(error)
  if (csrf) return csrf
  return error.message
}

// ── Cambio de la contraseña propia (`POST /auth/password`) ────────────────────

/** Campo del formulario al que se ata un error, o `null` si es del formulario entero. */
export type ChangePasswordErrorField = 'currentPassword' | 'newPassword' | null

export interface ChangePasswordError {
  field: ChangePasswordErrorField
  message: string
}

/**
 * Traduce un error de `POST /auth/password` al copy del formulario, atado al campo culpable cuando
 * lo hay. Los 401 no llegan acá con sentido: los atiende el handler global de sesión.
 *
 * El 429 dice «un minuto» y no «unos segundos» porque el límite es 5/min por usuario + IP, y
 * cuenta también los intentos con la contraseña actual equivocada.
 */
export function changePasswordErrorMessage(error: ApiError): ChangePasswordError {
  if (error.status === 429) {
    return {
      field: null,
      message: 'Hiciste demasiados intentos. Esperá un minuto y volvé a probar.',
    }
  }
  switch (error.code) {
    case AUTH_PASSWORD_ERROR_CODES.invalidCurrentPassword:
      return { field: 'currentPassword', message: 'La contraseña actual no es correcta.' }
    case AUTH_PASSWORD_ERROR_CODES.passwordUnchanged:
      return {
        field: 'newPassword',
        message: 'La contraseña nueva tiene que ser distinta de la actual.',
      }
    case GATEWAY_USER_ERROR_CODES.weakPassword: {
      const min = error.gatewayUserContext?.minLength
      return {
        field: 'newPassword',
        message:
          min != null
            ? `La contraseña es demasiado corta: necesita al menos ${min} caracteres.`
            : 'La contraseña es demasiado corta.',
      }
    }
  }
  const csrf = csrfErrorCopy(error)
  if (csrf) return { field: null, message: csrf }
  if (isAccessForbidden(error)) return { field: null, message: forbiddenCopy().body }
  return { field: null, message: error.message }
}

/**
 * Copy del éxito. `revoked` son las sesiones OTRAS que la actual: esta pestaña sigue abierta.
 */
export function passwordChangedMessage(revoked: number): string {
  if (revoked === 0) return 'Tu contraseña cambió. No había otras sesiones abiertas.'
  if (revoked === 1) return 'Tu contraseña cambió. Se cerró 1 sesión en otro lugar.'
  return `Tu contraseña cambió. Se cerraron ${revoked} sesiones en otros lugares.`
}

/** Destino de un alcance: lo que se intentó borrar y bloquea `access.scope_has_grants`. */
export type GrantScopeTarget = 'environment' | 'server'

const SCOPE_TARGET_LABEL: Record<GrantScopeTarget, string> = {
  environment: 'este entorno',
  server: 'este servidor',
}

const SCOPE_HAS_GRANTS_FIX = 'Quitáselos primero desde la página de accesos de cada usuario.'

/**
 * Copy del 409 `access.scope_has_grants` al borrar un entorno o un servidor, o `null` si el error
 * es otro.
 *
 * Vive en `auth` y no en cada feature porque lo comparten entornos y servidores, y la salida es la
 * misma en los dos: los accesos se quitan desde la página de accesos de cada usuario. El backend
 * rechaza en vez de borrar en cascada a propósito: quitar accesos es una decisión de quien los
 * administra, no un efecto colateral de ordenar el inventario.
 *
 * Los conteos salen de `public_context`; una parte en cero se omite, y si no llega ninguno (o los
 * dos son cero) se dice lo mismo sin números en vez de inventarlos.
 */
export function scopeHasGrantsMessage(error: ApiError, target: GrantScopeTarget): string | null {
  if (error.code !== SCOPE_HAS_GRANTS_CODE) return null
  const roles = error.gatewayUserContext?.accessGrantCount ?? 0
  const puntuales = error.gatewayUserContext?.capabilityGrantCount ?? 0
  const where = SCOPE_TARGET_LABEL[target]

  const parts: string[] = []
  if (roles > 0) parts.push(`${roles} ${roles === 1 ? 'permiso' : 'permisos'} por alcance`)
  if (puntuales > 0) {
    parts.push(`${puntuales} ${puntuales === 1 ? 'capacidad puntual' : 'capacidades puntuales'}`)
  }
  if (parts.length === 0) {
    return `No se puede borrar: todavía hay accesos que apuntan a ${where}. ${SCOPE_HAS_GRANTS_FIX}`
  }
  const verb = roles + puntuales === 1 ? 'apunta' : 'apuntan'
  return `No se puede borrar: ${parts.join(' y ')} todavía ${verb} a ${where}. ${SCOPE_HAS_GRANTS_FIX}`
}
