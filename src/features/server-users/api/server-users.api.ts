import {
  fetchData,
  fetchList,
  fetchPage,
  mutateData,
  mutateVoid,
  type QueryParams,
} from '@/lib/api/client'
import {
  managedDatabaseOutSchema,
  serverUserOutSchema,
  type ManagedDatabaseOut,
  type Page,
  type ServerUserCreate,
  type ServerUserOut,
  type ServerUserUpdate,
} from '@/lib/contracts'

const BASE = '/server-users'

export function listServerUsers(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<ServerUserOut>> {
  return fetchPage(BASE, serverUserOutSchema, { query: params, signal })
}

export function getServerUser(id: number, signal?: AbortSignal): Promise<ServerUserOut> {
  return fetchData(`${BASE}/${id}`, serverUserOutSchema, { signal })
}

/** `provision=true` 🔌 ejecuta `CREATE USER` (requiere password). */
export function createServerUser(
  body: ServerUserCreate,
  provision: boolean,
): Promise<ServerUserOut> {
  return mutateData('POST', BASE, serverUserOutSchema, { body, query: { provision } })
}

/** `provision=true` 🔌 ejecuta `ALTER USER` solo si se envía un nuevo password. */
export function updateServerUser(
  id: number,
  body: ServerUserUpdate,
  provision: boolean,
): Promise<ServerUserOut> {
  return mutateData('PATCH', `${BASE}/${id}`, serverUserOutSchema, { body, query: { provision } })
}

/** `drop_remote=true` 🔌 ejecuta `DROP USER` (exige `confirm_username` exacto). */
export function deleteServerUser(
  id: number,
  options: { dropRemote: boolean; confirmUsername?: string },
): Promise<string | undefined> {
  return mutateVoid('DELETE', `${BASE}/${id}`, {
    query: { drop_remote: options.dropRemote, confirm_username: options.confirmUsername },
  })
}

/** BDs cuyo owner es este usuario. */
export function listOwnedDatabases(
  id: number,
  signal?: AbortSignal,
): Promise<ManagedDatabaseOut[]> {
  return fetchList(`${BASE}/${id}/databases`, managedDatabaseOutSchema, { signal })
}
