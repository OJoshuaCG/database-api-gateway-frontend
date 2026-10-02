import { fetchData, fetchList, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  acceptInviteOutSchema,
  gatewayUserCreatedWriteOutSchema,
  gatewayUserInviteOutSchema,
  gatewayUserOutSchema,
  gatewayUserSessionSchema,
  gatewayUserSessionsRevokedSchema,
  gatewayUserWriteOutSchema,
  type AcceptInviteIn,
  type AcceptInviteOut,
  type GatewayUserAccessUpdate,
  type GatewayUserCreate,
  type GatewayUserCreatedWriteOut,
  type GatewayUserInviteOut,
  type GatewayUserOut,
  type GatewayUserSession,
  type GatewayUserSessionsRevoked,
  type GatewayUserUpdate,
  type GatewayUserWriteOut,
  type Page,
} from '@/lib/contracts'

const BASE = '/gateway-users'

/**
 * `GET /gateway-users` — el ÚNICO del módulo que viene paginado (§2). Los demás usan el
 * `success()` plano: pedirles `pagination` haría fallar el `safeParse`.
 */
export function listGatewayUsers(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<GatewayUserOut>> {
  return fetchPage(BASE, gatewayUserOutSchema, { query: params, signal })
}

export function getGatewayUser(id: number, signal?: AbortSignal): Promise<GatewayUserOut> {
  return fetchData(`${BASE}/${id}`, gatewayUserOutSchema, { signal })
}

/**
 * `POST /gateway-users` → 201. El alta NO lleva contraseña (§2.2) y devuelve el token de
 * invitación, que viaja acá y en ninguna otra respuesta: quien llame a esto TIENE que entregarlo.
 *
 * ⚠️ Puede ser **202 `access.elevation_pending`** (v29 §9.3): si el alta pedía `owner` o una
 * global, la cuenta nace sin eso (viewer/operator, sin globales), la invitación se emite igual y
 * la elevación queda en `pending_request`. Ver `pendingElevationOf`.
 */
export function createGatewayUser(body: GatewayUserCreate): Promise<GatewayUserCreatedWriteOut> {
  return mutateData('POST', BASE, gatewayUserCreatedWriteOutSchema, { body })
}

/**
 * `POST /gateway-users/invite/accept` — **público**: sin sesión y sin CSRF. Lo usa alguien que
 * todavía no puede iniciar sesión, que es justamente el punto del diseño.
 *
 * `suppressAuthHandler` evita que un 401 dispare el flujo global de sesión caída: quien está en
 * esta pantalla no tiene sesión que caducar, y mandarlo al login sería mandarlo a una puerta que
 * todavía no puede abrir. El 200 tampoco abre sesión — hay que llevarlo al login normal.
 */
export function acceptGatewayUserInvite(body: AcceptInviteIn): Promise<AcceptInviteOut> {
  return mutateData('POST', `${BASE}/invite/accept`, acceptInviteOutSchema, {
    body,
    suppressAuthHandler: true,
    // Uno de los DOS únicos POST sin CSRF (v23 §7.1): el token se deriva del identificador de
    // sesión y acá todavía no hay sesión. Mandarlo sería mandar el de otra persona.
    csrf: false,
  })
}

/**
 * `PATCH /gateway-users/{id}` — `exclude_unset`; `username` NO es editable por diseño (§2.5). Subir
 * a `owner` responde 202 (v29 §9.3): el resto del PATCH se aplica y el rol queda pendiente.
 */
export function updateGatewayUser(
  id: number,
  body: GatewayUserUpdate,
): Promise<GatewayUserWriteOut> {
  return mutateData('PATCH', `${BASE}/${id}`, gatewayUserWriteOutSchema, { body })
}

/**
 * `PUT /gateway-users/{id}/access` — ⚠️ REEMPLAZO TOTAL (§2.6). Omitir un campo equivale a
 * enviarlo vacío, y vacío REVOCA. El cuerpo tiene que traer el estado completo, no el delta.
 *
 * Con una elevación responde 202 (v29 §9.3): las altas `viewer`/`operator` y las bajas se aplican
 * ya, y `pending_request.desired` es el acceso FINAL que queda si otra persona lo aprueba.
 */
export function replaceGatewayUserAccess(
  id: number,
  body: GatewayUserAccessUpdate,
): Promise<GatewayUserWriteOut> {
  return mutateData('PUT', `${BASE}/${id}/access`, gatewayUserWriteOutSchema, { body })
}

/**
 * `POST /gateway-users/{id}/invite` — reinvitar es también REVOCAR: emitir una nueva sube el
 * `credential_epoch` e invalida la anterior (§2.7). Sobre una cuenta que ya fijó contraseña
 * responde 409 `gateway_user.credential_already_set`.
 */
export function reissueGatewayUserInvite(id: number): Promise<GatewayUserInviteOut> {
  return mutateData('POST', `${BASE}/${id}/invite`, gatewayUserInviteOutSchema, {})
}

/**
 * `GET /gateway-users/{id}/sessions` — sesiones VIVAS de otra persona (v29 §11.5), la más reciente
 * primero. `access.admin`; sin `sid` (es la credencial) porque la revocación las cierra todas.
 */
export function listGatewayUserSessions(
  id: number,
  signal?: AbortSignal,
): Promise<GatewayUserSession[]> {
  return fetchList(`${BASE}/${id}/sessions`, gatewayUserSessionSchema, { signal })
}

/**
 * `POST /gateway-users/{id}/sessions/revoke` — cierra TODAS las sesiones vivas de OTRA persona
 * (v29 §11.6). Pide step-up: el 403 `access.step_up_required` lo resuelve el cliente. Sobre uno
 * mismo responde 409 `access.self_modification_forbidden` (lo propio es «Mi cuenta»).
 */
export function revokeGatewayUserSessions(id: number): Promise<GatewayUserSessionsRevoked> {
  return mutateData('POST', `${BASE}/${id}/sessions/revoke`, gatewayUserSessionsRevokedSchema, {})
}
