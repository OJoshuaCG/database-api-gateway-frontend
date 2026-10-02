import { fetchData, fetchList, mutateData } from '@/lib/api/client'
import {
  accessRequestSchema,
  pendingAccessRequestSchema,
  type AccessRequest,
  type AccessRequestDecision,
  type PendingAccessRequest,
} from '@/lib/contracts'

const BASE = '/access-requests'

/**
 * `GET /access-requests/pending` — elevaciones vigentes de TODAS las personas, con `can_decide` y
 * `blocked_reason` para quien pregunta. Las vencidas se barren antes de listar. Lista no paginada.
 */
export function listPendingAccessRequests(signal?: AbortSignal): Promise<PendingAccessRequest[]> {
  return fetchList(`${BASE}/pending`, pendingAccessRequestSchema, { signal })
}

/** `GET /access-requests/{id}` — una solicitud en cualquier estado (404 `access.request_not_found`). */
export function getAccessRequest(id: number, signal?: AbortSignal): Promise<AccessRequest> {
  return fetchData(`${BASE}/${id}`, accessRequestSchema, { signal })
}

/** `POST /access-requests/{id}/approve` — aplica la elevación. Step-up; la decide OTRO access_admin. */
export function approveAccessRequest(
  id: number,
  body: AccessRequestDecision = {},
): Promise<AccessRequest> {
  return mutateData('POST', `${BASE}/${id}/approve`, accessRequestSchema, { body })
}

/** `POST /access-requests/{id}/reject` — `pending` → `rejected`. Cualquier access_admin; step-up. */
export function rejectAccessRequest(
  id: number,
  body: AccessRequestDecision = {},
): Promise<AccessRequest> {
  return mutateData('POST', `${BASE}/${id}/reject`, accessRequestSchema, { body })
}

/**
 * `POST /access-requests/{id}/cancel` — `pending` → `cancelled`. **Solo quien la pidió** (409
 * `access.request_not_requester`) y **sin step-up**: retirar algo propio nunca da acceso.
 */
export function cancelAccessRequest(
  id: number,
  body: AccessRequestDecision = {},
): Promise<AccessRequest> {
  return mutateData('POST', `${BASE}/${id}/cancel`, accessRequestSchema, { body })
}
