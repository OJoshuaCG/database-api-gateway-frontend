import { fetchList, mutateData, type QueryParams } from '@/lib/api/client'
import { privilegeOutSchema, type PrivilegeOut } from '@/lib/contracts'

const BASE = '/privileges'

/** `GET /privileges` — NO paginado (§10). */
export function listPrivileges(params: QueryParams, signal?: AbortSignal): Promise<PrivilegeOut[]> {
  return fetchList(BASE, privilegeOutSchema, { query: params, signal })
}

/** `PATCH /privileges/{id}` — activa/desactiva un privilegio. */
export function togglePrivilege(id: number, isActive: boolean): Promise<PrivilegeOut> {
  return mutateData('PATCH', `${BASE}/${id}`, privilegeOutSchema, { body: { is_active: isActive } })
}
