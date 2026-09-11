import { GATEWAY_USER_ERROR_CODES } from '@/lib/contracts'
import type { ApiError } from '@/lib/api/errors'

/**
 * Copy de los errores del módulo de usuarios del gateway (§2.9 y §6).
 *
 * Vive en un módulo propio, y no repartido por los hooks, por dos motivos concretos:
 *
 * 1. **`gateway_user.not_found` llega con DOS status y significan cosas distintas.** 404 es «ese
 *    id no existe» y manda a refrescar el listado; 422 es «esta invitación no sirve» y manda a
 *    pedir otra. Un cliente que enrute solo por `code` muestra el mensaje equivocado en uno de los
 *    dos casos, y el bug es invisible hasta que alguien pega un token viejo.
 * 2. **Varias respuestas de este flujo NO traen `public_context.code`** (§6): la invitación vencida
 *    es un 410 pelado, y cualquier 429 llega sin código y sin `Retry-After`. Ahí lo único que se
 *    puede leer es el status, y el copy tiene que salir del contexto de la llamada.
 */

/** Espera fija sugerida tras un 429. No hay `Retry-After` con qué calcular un backoff (§6). */
export const RATE_LIMIT_HINT =
  'Se alcanzó el límite de solicitudes. Espera unos segundos y vuelve a intentarlo.'

/**
 * Mensaje para un error de las pantallas ADMINISTRADAS (listado, alta, edición, accesos,
 * reinvitar). Devuelve `null` cuando no reconoce el caso, para que el llamador caiga en
 * `apiError.message` y nunca oculte información al usuario.
 */
export function gatewayUserErrorMessage(error: ApiError): string | null {
  if (error.status === 429) return RATE_LIMIT_HINT

  switch (error.code) {
    case GATEWAY_USER_ERROR_CODES.lastAdminProtected:
      return 'Es el último administrador de accesos activo. Otorga `access_admin` a otro usuario activo antes de quitárselo o desactivarlo.'
    case GATEWAY_USER_ERROR_CODES.usernameTaken:
      return 'Ya existe un usuario con ese nombre. Elige otro.'
    case GATEWAY_USER_ERROR_CODES.credentialAlreadySet:
      return 'Esta cuenta ya fijó su contraseña: la invitación es solo para la primera credencial. Para reemplazarla, la persona la cambia desde su propia sesión.'
    case GATEWAY_USER_ERROR_CODES.notFound:
      // Solo el 404 corresponde a estas pantallas. El 422 del mismo código es de la pantalla
      // pública de invitación y lo resuelve `acceptInviteErrorMessage`.
      return error.status === 404
        ? 'Este usuario ya no existe. Vuelve al listado y refréscalo.'
        : null
    case GATEWAY_USER_ERROR_CODES.invalidRole:
      return roleOrCapabilityMessage(error, 'El rol enviado no es válido.')
    case GATEWAY_USER_ERROR_CODES.invalidGlobalCapability:
      // ⚠️ Este código cubre DOS errores distintos: una capacidad global inválida (que trae
      // `allowed[]`) y un `scope_type` inválido en `PUT /access` (que NO lo trae). Hasta que el
      // backend los separe, el mensaje genérico tiene que servir para los dos.
      return roleOrCapabilityMessage(
        error,
        'Hay un valor no admitido en los accesos: revisa las capacidades globales y el tipo de alcance de cada permiso.',
      )
    default:
      return null
  }
}

/** Suma el `allowed[]` del backend al mensaje cuando viene; si no, deja el genérico. */
function roleOrCapabilityMessage(error: ApiError, fallback: string): string {
  const allowed = error.gatewayUserContext?.allowed
  if (!allowed?.length) return fallback
  return `${fallback} Admitidos: ${allowed.join(', ')}.`
}

/**
 * Mensaje para la pantalla PÚBLICA de aceptar la invitación (§2.4).
 *
 * El endpoint **no distingue** «token inválido» de «usuario inexistente» de «ya se usó»: los tres
 * responden 422 `gateway_user.not_found`, a propósito, para no convertirlo en un oráculo de qué
 * invitaciones hay pendientes. Por eso el copy cubre los tres con un solo mensaje y ofrece la
 * única salida real: pedir una invitación nueva.
 *
 * Un token VENCIDO responde distinto —410, y sin código— así que se enruta por status.
 */
export function acceptInviteErrorMessage(error: ApiError): string {
  if (error.status === 410) {
    return 'Esta invitación venció. Pídele una nueva a quien administra los accesos.'
  }
  if (error.status === 429) return RATE_LIMIT_HINT
  if (error.code === GATEWAY_USER_ERROR_CODES.weakPassword) {
    const min = error.gatewayUserContext?.minLength
    return min != null
      ? `La contraseña es demasiado corta: necesita al menos ${min} caracteres.`
      : 'La contraseña es demasiado corta.'
  }
  if (error.code === GATEWAY_USER_ERROR_CODES.notFound) {
    return 'La invitación no es válida o ya se usó. Pídele una nueva a quien administra los accesos.'
  }
  return error.message
}
