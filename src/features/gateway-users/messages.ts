import { CAPABILITY_GRANT_ERROR_CODES, GATEWAY_USER_ERROR_CODES } from '@/lib/contracts'
import type { ApiError } from '@/lib/api/errors'
import { SELF_ACCESS_NOTE } from './self-access'

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
  'Se alcanzó el límite de solicitudes. Esperá unos segundos y volvé a intentarlo.'

/** `access.self_modification_forbidden`: el mismo motivo que muestra la fila propia. */
export const SELF_MODIFICATION_MESSAGE = `No podés cambiar tu propio rol, tu propio acceso ni desactivar tu cuenta. ${SELF_ACCESS_NOTE}`

/**
 * `access.grant_ceiling_exceeded`: el texto propio (en voseo). El `msg` del backend viene en tú
 * («No puedes otorgar más acceso del que tienes: rol base 'owner'. Pídeselo…»), así que no se
 * muestra tal cual: de él se toma solo el DETALLE de qué se excedió (`grantCeilingDetail`).
 */
export const GRANT_CEILING_FALLBACK =
  'No podés otorgar más acceso del que tenés. Pedíselo a alguien que tenga ese nivel.'

/**
 * Lo que se excedió, tal como lo enumera el backend (`_assert_within_ceiling`): «rol base
 * 'owner'», «rol por alcance 'owner'», «capacidades globales [security_officer]», separados por
 * «; ». `null` si el mensaje no tiene esa forma: entonces solo va el respaldo.
 */
export function grantCeilingDetail(backendMessage: string): string | null {
  const match = /tienes:\s*(.+?)\.\s*P[ií]d/u.exec(backendMessage)
  const detail = match?.[1]?.trim()
  return detail ? detail : null
}

/**
 * Mensaje para un error de las pantallas ADMINISTRADAS (listado, alta, edición, accesos,
 * reinvitar). Devuelve `null` cuando no reconoce el caso, para que el llamador caiga en
 * `apiError.message` y nunca oculte información al usuario.
 */
export function gatewayUserErrorMessage(error: ApiError): string | null {
  if (error.status === 429) return RATE_LIMIT_HINT

  switch (error.code) {
    case GATEWAY_USER_ERROR_CODES.lastAdminProtected:
      return 'Es el último administrador de accesos activo. Otorgá `access_admin` a otro usuario activo antes de quitárselo o desactivarlo.'
    case GATEWAY_USER_ERROR_CODES.usernameTaken:
      return 'Ya existe un usuario con ese nombre. Elegí otro.'
    case GATEWAY_USER_ERROR_CODES.credentialAlreadySet:
      return 'Esta cuenta ya fijó su contraseña: la invitación es solo para la primera credencial. Para reemplazarla, la persona la cambia ella misma desde «Mi cuenta» → «Contraseña», con su contraseña actual.'
    case GATEWAY_USER_ERROR_CODES.notFound:
      // Solo el 404 corresponde a estas pantallas. El 422 del mismo código es de la pantalla
      // pública de invitación y lo resuelve `acceptInviteErrorMessage`.
      return error.status === 404
        ? 'Este usuario ya no existe. Volvé al listado y refrescalo.'
        : null
    case GATEWAY_USER_ERROR_CODES.selfModificationForbidden:
      return SELF_MODIFICATION_MESSAGE
    case GATEWAY_USER_ERROR_CODES.grantCeilingExceeded: {
      // `type` presente = el cuerpo era el envelope del backend, así que `message` es su `msg`,
      // no el genérico del status. De ahí sale solo el detalle; la frase es la nuestra.
      const detail = error.type ? grantCeilingDetail(error.message) : null
      return detail ? `${GRANT_CEILING_FALLBACK} Lo que excede: ${detail}.` : GRANT_CEILING_FALLBACK
    }
    case GATEWAY_USER_ERROR_CODES.invalidRole:
      return roleOrCapabilityMessage(error, 'El rol enviado no es válido.')
    case GATEWAY_USER_ERROR_CODES.invalidGlobalCapability:
      // ⚠️ Este código cubre DOS errores distintos: una capacidad global inválida (que trae
      // `allowed[]`) y un `scope_type` inválido en `PUT /access` (que NO lo trae). Hasta que el
      // backend los separe, el mensaje genérico tiene que servir para los dos.
      return roleOrCapabilityMessage(
        error,
        'Hay un valor no admitido en los accesos: revisá las capacidades globales y el tipo de alcance de cada permiso.',
      )
    case GATEWAY_USER_ERROR_CODES.grantScopeNotFound:
      return grantScopeNotFoundMessage(error)
    default:
      return null
  }
}

const SCOPE_TYPE_LABEL: Record<string, string> = {
  environment: 'el entorno',
  server: 'el servidor',
}

/**
 * 422 `access.grant_scope_not_found` de `PUT /access`: algún permiso apunta a un entorno o
 * servidor que se borró mientras la pantalla estaba abierta. No se escribió nada, y la única salida
 * es recargar para que el selector deje de ofrecer ese destino. Si viene `missing_scopes`, se
 * nombran los ids; un `scope_type` desconocido cae en «el destino» en vez de romper.
 */
function grantScopeNotFoundMessage(error: ApiError): string {
  const base =
    'Algún entorno o servidor de los permisos ya no existe, así que no se guardó nada. Recargá la página y volvé a elegir el destino.'
  const missing = error.gatewayUserContext?.missingScopes
  if (!missing?.length) return base
  const names = missing.map(
    ({ scopeType, scopeId }) => `${SCOPE_TYPE_LABEL[scopeType] ?? 'el destino'} #${scopeId}`,
  )
  return `${base} Ya no existe: ${names.join(', ')}.`
}

/**
 * Copy fijo de cada código de las capacidades puntuales, en voseo. Un solo mapa para dos usos: el
 * error de una mutación (`capabilityGrantErrorMessage`) y el `blocked_reason` de la bandeja de
 * pendientes (`capabilityGrantBlockedMessage`), que llega como el mismo código `access.*` pero
 * sin ser un error HTTP.
 *
 * `grantCeilingExceeded` queda fuera a propósito: su texto depende del `msg` del backend y lo
 * arma `gatewayUserErrorMessage`.
 */
const CAPABILITY_GRANT_COPY: Record<string, string> = {
  [CAPABILITY_GRANT_ERROR_CODES.selfModificationForbidden]:
    'No podés otorgarte ni quitarte capacidades a vos mismo. Pedile a otra persona con `access_admin` que lo haga.',
  [CAPABILITY_GRANT_ERROR_CODES.selfApprovalForbidden]:
    'No podés aprobar una capacidad que pediste vos. La decide otra persona con `access_admin`.',
  [CAPABILITY_GRANT_ERROR_CODES.grantUserInactive]:
    'Esta cuenta está desactivada, así que no puede recibir capacidades. Reactivala primero.',
  [CAPABILITY_GRANT_ERROR_CODES.capabilityNotGrantable]:
    'Esa capacidad no se puede otorgar de forma puntual. Elegí otra o cambiá el rol de la persona.',
  [CAPABILITY_GRANT_ERROR_CODES.grantScopeNotFound]:
    'El entorno o servidor elegido ya no existe. Refrescá la pantalla y elegí otro.',
  [CAPABILITY_GRANT_ERROR_CODES.grantDuplicate]:
    'Esa persona ya tiene esa capacidad sobre ese destino, activa o pendiente de aprobación.',
  [CAPABILITY_GRANT_ERROR_CODES.grantNotFound]:
    'Esa capacidad ya no existe. Refrescá la lista para ver el estado actual.',
  [CAPABILITY_GRANT_ERROR_CODES.grantNotPending]:
    'Esa solicitud ya no está pendiente: otra persona la decidió, venció o se canceló. Refrescá la lista.',
}

/**
 * Mensaje para un error de las operaciones sobre capacidades puntuales (alta, revocación,
 * aprobación, rechazo, listado). Cubre los nueve códigos y, si no lo reconoce, cae al copy general
 * del módulo; `null` deja que el llamador use `apiError.message`.
 */
export function capabilityGrantErrorMessage(error: ApiError): string | null {
  const own = error.code ? CAPABILITY_GRANT_COPY[error.code] : undefined
  return own ?? gatewayUserErrorMessage(error)
}

/**
 * Por qué una solicitud pendiente no se puede decidir, a partir del `blocked_reason` de la bandeja
 * (un código `access.*`). `null` si no hay motivo; un código desconocido devuelve el genérico para
 * no dejar un botón deshabilitado sin explicación.
 */
export function capabilityGrantBlockedMessage(code: string | null | undefined): string | null {
  if (!code) return null
  // Sin `msg` del backend no hay detalle de qué se excedió: va solo el texto de respaldo.
  if (code === CAPABILITY_GRANT_ERROR_CODES.grantCeilingExceeded) return GRANT_CEILING_FALLBACK
  return (
    CAPABILITY_GRANT_COPY[code] ??
    'No podés decidir esta solicitud ahora. Consultá con otra persona con `access_admin`.'
  )
}

/** Suma el `allowed[]` del backend al mensaje cuando viene; si no, deja el genérico. */
function roleOrCapabilityMessage(error: ApiError, fallback: string): string {
  const allowed = error.gatewayUserContext?.allowed
  if (!allowed?.length) return fallback
  return `${fallback} Admitidos: ${allowed.join(', ')}.`
}

const INVALID_INVITE_MESSAGE =
  'La invitación no es válida, venció o ya se usó. Pedile una nueva a quien administra los accesos.'

/**
 * Mensaje para la pantalla PÚBLICA de aceptar la invitación (§2.4).
 *
 * El endpoint **no distingue** «token inválido» de «vencido» de «usuario inexistente» de «ya se
 * usó»: todos responden 422 `gateway_user.not_found`, a propósito, para no convertirlo en un oráculo
 * de qué invitaciones hay pendientes. Por eso el copy cubre todos con un solo mensaje y ofrece la
 * única salida real: pedir una invitación nueva.
 *
 * Un backend anterior respondía 410 para la vencida; se trata igual, para no reintroducir en la UI
 * la distinción que el backend dejó de hacer.
 */
export function acceptInviteErrorMessage(error: ApiError): string {
  if (error.status === 410) return INVALID_INVITE_MESSAGE
  if (error.status === 429) return RATE_LIMIT_HINT
  if (error.code === GATEWAY_USER_ERROR_CODES.weakPassword) {
    const min = error.gatewayUserContext?.minLength
    return min != null
      ? `La contraseña es demasiado corta: necesita al menos ${min} caracteres.`
      : 'La contraseña es demasiado corta.'
  }
  if (error.code === GATEWAY_USER_ERROR_CODES.notFound) return INVALID_INVITE_MESSAGE
  return error.message
}
