import { fetchData, fetchList, mutateData } from '@/lib/api/client'
import {
  capabilityGrantSchema,
  effectiveAccessSchema,
  pendingCapabilityGrantSchema,
  type CapabilityGrant,
  type CapabilityGrantCreate,
  type CapabilityGrantDecision,
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
