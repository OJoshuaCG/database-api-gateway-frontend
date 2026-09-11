import { AUTH_CSRF_ERROR_CODES, AUTH_SESSION_ERROR_CODES } from '@/lib/contracts'
import type { ApiError } from '@/lib/api/errors'

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

/** ¿Este error es un rechazo de CSRF? Para decidir si conviene registrar el bug en consola. */
export function isCsrfError(error: ApiError): boolean {
  return csrfErrorCopy(error) !== null
}
