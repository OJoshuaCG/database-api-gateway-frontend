import {
  fetchData,
  fetchList,
  fetchPage,
  mutateData,
  mutateVoid,
  type QueryParams,
} from '@/lib/api/client'
import {
  applyProfileBulkResultSchema,
  applyProfileResultSchema,
  grantInfoSchema,
  grantResultSchema,
  managedDatabaseOutSchema,
  serverUserFullOutSchema,
  serverUserOutSchema,
  type AdoptUserIn,
  type ApplyProfileBulkRequest,
  type ApplyProfileBulkResult,
  type ApplyProfileRequest,
  type ApplyProfileResult,
  type GrantInfo,
  type GrantRequest,
  type GrantResult,
  type ManagedDatabaseOut,
  type Page,
  type RevokeRequest,
  type ServerUserCreate,
  type ServerUserFullCreate,
  type ServerUserFullOut,
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

/**
 * `POST /server-users/adopt` 🔌 (Plan 09 §4) — registra un usuario **ya existente** en el motor
 * sin recrearlo ni conocer su password (`has_password=false`). En PostgreSQL `host` se ignora.
 */
export function adoptUser(body: AdoptUserIn): Promise<ServerUserOut> {
  return mutateData('POST', `${BASE}/adopt`, serverUserOutSchema, { body })
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

// ── Grants granulares 🔌 (§7) ───────────────────────────────────────────────

/** `GET /server-users/{id}/grants` 🔌 — permisos efectivos. PG: `database` obligatorio. */
export function listUserGrants(
  id: number,
  database?: string,
  signal?: AbortSignal,
): Promise<GrantInfo[]> {
  return fetchList(`${BASE}/${id}/grants`, grantInfoSchema, { query: { database }, signal })
}

/** `POST /server-users/{id}/grants` 🔌 — otorga privilegios (pre-chequea `can_grant`). */
export function grantPrivileges(id: number, body: GrantRequest): Promise<GrantResult> {
  return mutateData('POST', `${BASE}/${id}/grants`, grantResultSchema, { body })
}

/** `DELETE /server-users/{id}/grants` 🔌 — revoca (cuerpo en el DELETE). */
export function revokePrivileges(
  id: number,
  body: RevokeRequest,
  confirmGrantee?: string,
): Promise<string | undefined> {
  return mutateVoid('DELETE', `${BASE}/${id}/grants`, {
    body,
    query: { confirm_grantee: confirmGrantee },
  })
}

/** `POST /server-users/{id}/apply-profile/{profile_id}` 🔌 — aplica un perfil de permisos. */
export function applyProfile(
  id: number,
  profileId: number,
  body: ApplyProfileRequest,
): Promise<ApplyProfileResult> {
  return mutateData('POST', `${BASE}/${id}/apply-profile/${profileId}`, applyProfileResultSchema, {
    body,
  })
}

/** `POST /server-users/provision` 🔌 — crea + aprovisiona + aplica `initial_grants`. */
export function provisionServerUser(body: ServerUserFullCreate): Promise<ServerUserFullOut> {
  return mutateData('POST', `${BASE}/provision`, serverUserFullOutSchema, { body })
}

/**
 * `POST /server-users/{id}/apply-profile/{profile_id}/bulk` 🔌 (v21 §11) — el mismo perfil sobre
 * N bases en una sola llamada.
 *
 * Dos cosas que no se pueden leer del status HTTP y por eso viven en el JSDoc:
 *
 * 1. **Siempre responde 200**, aunque TODAS las bases hayan fallado. El 422 de «no se aplicó
 *    ningún permiso» del endpoint de una sola base (§9) **no rige acá**: el estado real está en
 *    `results[].ok`. Lo que sí corta con error son las validaciones previas al lote —404 de
 *    usuario/perfil, 409 de perfil desactivado, 422 de motor incompatible—, que se evalúan una
 *    sola vez antes de tocar ninguna base.
 * 2. **Nunca revoca**: solo agrega privilegios. Por eso un error acá es recuperable con un
 *    `REVOKE`, y por eso su cota (5/min) es más laxa que la de las operaciones destructivas.
 */
export function applyProfileBulk(
  id: number,
  profileId: number,
  body: ApplyProfileBulkRequest,
): Promise<ApplyProfileBulkResult> {
  return mutateData(
    'POST',
    `${BASE}/${id}/apply-profile/${profileId}/bulk`,
    applyProfileBulkResultSchema,
    { body },
  )
}
