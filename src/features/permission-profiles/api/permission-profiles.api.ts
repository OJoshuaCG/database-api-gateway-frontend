import { fetchData, fetchList, mutateData, mutateVoid, type QueryParams } from '@/lib/api/client'
import {
  permissionProfileOutSchema,
  type PermissionProfileCreate,
  type PermissionProfileOut,
  type PermissionProfileUpdate,
} from '@/lib/contracts'

const BASE = '/permission-profiles'

/** `GET /permission-profiles` — NO paginado; filtros `engine?`, `active?` (§11). */
export function listPermissionProfiles(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<PermissionProfileOut[]> {
  return fetchList(BASE, permissionProfileOutSchema, { query: params, signal })
}

export function getPermissionProfile(
  id: number,
  signal?: AbortSignal,
): Promise<PermissionProfileOut> {
  return fetchData(`${BASE}/${id}`, permissionProfileOutSchema, { signal })
}

export function createPermissionProfile(
  body: PermissionProfileCreate,
): Promise<PermissionProfileOut> {
  return mutateData('POST', BASE, permissionProfileOutSchema, { body })
}

/** `PATCH` — `engine` inmutable; si envías `items`, reemplazan los anteriores (§11). */
export function updatePermissionProfile(
  id: number,
  body: PermissionProfileUpdate,
): Promise<PermissionProfileOut> {
  return mutateData('PATCH', `${BASE}/${id}`, permissionProfileOutSchema, { body })
}

export function deletePermissionProfile(id: number): Promise<string | undefined> {
  return mutateVoid('DELETE', `${BASE}/${id}`)
}
