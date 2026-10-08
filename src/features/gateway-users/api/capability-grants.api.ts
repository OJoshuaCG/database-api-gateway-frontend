import { fetchData, fetchList, mutateData } from '@/lib/api/client'
import {
  capabilityGrantBulkResultSchema,
  capabilityGrantDecisionBulkResultSchema,
  capabilityGrantSchema,
  effectiveAccessSchema,
  pendingCapabilityGrantSchema,
  type CapabilityGrant,
  type CapabilityGrantBulkCreate,
  type CapabilityGrantBulkResult,
  type CapabilityGrantCreate,
  type CapabilityGrantDecision,
  type CapabilityGrantDecisionBulk,
  type CapabilityGrantDecisionBulkResult,
  type CapabilityGrantStatus,
  type EffectiveAccess,
  type PendingCapabilityGrant,
} from '@/lib/contracts'

const USERS = '/gateway-users'

/**
 * `GET /gateway-users/{id}/capability-grants[?status=]` — historial completo de la persona (los
 * seis estados). Solo `access_admin`; lista NO paginada.
 */
export function listCapabilityGrants(
  userId: number,
  status?: CapabilityGrantStatus,
  signal?: AbortSignal,
): Promise<CapabilityGrant[]> {
  return fetchList(`${USERS}/${userId}/capability-grants`, capabilityGrantSchema, {
    query: { status },
    signal,
  })
}

/**
 * `POST /gateway-users/{id}/capability-grants` → 201. Una capacidad no sensible nace `active`; una
 * sensible nace `pending` y espera a una segunda persona. La respuesta dice cuál de las dos fue.
 */
export function createCapabilityGrant(
  userId: number,
  body: CapabilityGrantCreate,
): Promise<CapabilityGrant> {
  return mutateData('POST', `${USERS}/${userId}/capability-grants`, capabilityGrantSchema, {
    body,
  })
}

/**
 * `POST /gateway-users/{id}/capability-grants/bulk` → 201. Una o varias capacidades (`capability`
 * XOR `capabilities`) sobre varios destinos, todo o nada: un 409 `access.grant_bulk_failed` no deja
 * ninguna fila y nombra cada par que falló (`ApiError.gatewayUserContext.grantBulkFailures`).
 */
export function createCapabilityGrantsBulk(
  userId: number,
  body: CapabilityGrantBulkCreate,
): Promise<CapabilityGrantBulkResult> {
  return mutateData(
    'POST',
    `${USERS}/${userId}/capability-grants/bulk`,
    capabilityGrantBulkResultSchema,
    { body },
  )
}

/**
 * `DELETE /gateway-users/{id}/capability-grants/{gid}` → 200 con la capacidad ya cerrada en el
 * cuerpo (no es un 204). Activa pasa a `revoked`; pendiente, a `cancelled`.
 */
export function revokeCapabilityGrant(userId: number, grantId: number): Promise<CapabilityGrant> {
  return mutateData(
    'DELETE',
    `${USERS}/${userId}/capability-grants/${grantId}`,
    capabilityGrantSchema,
  )
}

/** `GET /gateway-users/{id}/effective-access` — solo `access_admin`; el propio se lee de `/auth/me`. */
export function getEffectiveAccess(userId: number, signal?: AbortSignal): Promise<EffectiveAccess> {
  return fetchData(`${USERS}/${userId}/effective-access`, effectiveAccessSchema, { signal })
}

/** `GET /capability-grants/pending` — la bandeja, con `can_decide` y `blocked_reason` por fila. */
export function listPendingCapabilityGrants(
  signal?: AbortSignal,
): Promise<PendingCapabilityGrant[]> {
  return fetchList('/capability-grants/pending', pendingCapabilityGrantSchema, { signal })
}

/** `POST /capability-grants/{id}/approve` — el cuerpo `{ reason }` es opcional. */
export function approveCapabilityGrant(
  grantId: number,
  body: CapabilityGrantDecision = {},
): Promise<CapabilityGrant> {
  return mutateData('POST', `/capability-grants/${grantId}/approve`, capabilityGrantSchema, {
    body,
  })
}

/** `POST /capability-grants/{id}/reject` — el cuerpo `{ reason }` es opcional. */
export function rejectCapabilityGrant(
  grantId: number,
  body: CapabilityGrantDecision = {},
): Promise<CapabilityGrant> {
  return mutateData('POST', `/capability-grants/${grantId}/reject`, capabilityGrantSchema, {
    body,
  })
}

/**
 * `POST /capability-grants/decisions` → 200 SIEMPRE, de mejor esfuerzo: cada solicitud se decide por
 * su cuenta y el resultado de cada una viene en `results[]`. Solo falla entero con 403 (incluido
 * `access.step_up_required`, que la capa de peticiones resuelve con UNA contraseña para todo el
 * lote) o 429.
 */
export function decideCapabilityGrantsBulk(
  body: CapabilityGrantDecisionBulk,
): Promise<CapabilityGrantDecisionBulkResult> {
  return mutateData(
    'POST',
    '/capability-grants/decisions',
    capabilityGrantDecisionBulkResultSchema,
    {
      body,
    },
  )
}
