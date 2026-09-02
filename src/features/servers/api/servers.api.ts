import { z } from 'zod'
import {
  fetchData,
  fetchList,
  fetchPage,
  mutateData,
  mutateVoid,
  type QueryParams,
} from '@/lib/api/client'
import {
  addHostOutSchema,
  batchAdoptOutSchema,
  connectionInfoSchema,
  engineRevealPasswordOutSchema,
  engineUserMutationOutSchema,
  grantableResultSchema,
  identityGrantsSchema,
  groupedEngineUsersOutSchema,
  knownPasswordSetOutSchema,
  passwordChangeBatchOutSchema,
  reconcileResultSchema,
  serverOutSchema,
  structureDumpSchema,
  tableSchemaSchema,
  type AddHostIn,
  type AddHostOut,
  type AdoptAllHostsIn,
  type BatchAdoptOut,
  type ConnectionInfo,
  type DefineKnownPasswordIn,
  type EnginePasswordChangeAllHostsIn,
  type EnginePasswordChangeIn,
  type EngineRevealPasswordIn,
  type EngineRevealPasswordOut,
  type EngineUserCreateIn,
  type EngineUserMutationOut,
  type GrantableRequest,
  type GrantableResult,
  type GroupedEngineUsersOut,
  type IdentityGrants,
  type KnownPasswordSetOut,
  type Page,
  type PasswordChangeBatchOut,
  type ReconcileResult,
  type ServerCreate,
  type ServerOut,
  type ServerUpdate,
  type StructureDump,
  type TableSchema,
} from '@/lib/contracts'

const BASE = '/servers'

export function listServers(params: QueryParams, signal?: AbortSignal): Promise<Page<ServerOut>> {
  return fetchPage(BASE, serverOutSchema, { query: params, signal })
}

export function getServer(id: number, signal?: AbortSignal): Promise<ServerOut> {
  return fetchData(`${BASE}/${id}`, serverOutSchema, { signal })
}

export function createServer(body: ServerCreate): Promise<ServerOut> {
  return mutateData('POST', BASE, serverOutSchema, { body })
}

export function updateServer(id: number, body: ServerUpdate): Promise<ServerOut> {
  return mutateData('PATCH', `${BASE}/${id}`, serverOutSchema, { body })
}

export function deleteServer(id: number): Promise<string | undefined> {
  return mutateVoid('DELETE', `${BASE}/${id}`)
}

// ── Operaciones contra el motor destino 🔌 ──────────────────────────────────
export function testConnection(id: number): Promise<ConnectionInfo> {
  return mutateData('POST', `${BASE}/${id}/test-connection`, connectionInfoSchema)
}

export function listServerDatabases(id: number, signal?: AbortSignal): Promise<string[]> {
  return fetchList(`${BASE}/${id}/databases`, z.string(), { signal })
}

/**
 * `GET /servers/{id}/reconcile` 🔌 (Plan 09 §2) — cruza el motor en vivo con el inventario y
 * devuelve el estado de reconciliación de cada BD/usuario. No muta nada.
 */
export function reconcileServer(id: number, signal?: AbortSignal): Promise<ReconcileResult> {
  return fetchData(`${BASE}/${id}/reconcile`, reconcileResultSchema, { signal })
}

/**
 * `GET /servers/{id}/databases/{db}/snapshot` 🔌 (Plan 09 §5) — estructura DDL completa de una BD
 * en orden de dependencia. Solo estructura, nunca filas. Con `includeDataStats=true` agrega
 * `table_stats` (una consulta extra de catálogo por tabla: más lento) para decidir qué catálogos
 * sembrar.
 */
export function getDatabaseSnapshot(
  id: number,
  database: string,
  options: { includeDataStats?: boolean; signal?: AbortSignal } = {},
): Promise<StructureDump> {
  const { includeDataStats = false, signal } = options
  return fetchData(
    `${BASE}/${id}/databases/${encodeURIComponent(database)}/snapshot`,
    structureDumpSchema,
    { query: includeDataStats ? { include_data_stats: true } : undefined, signal },
  )
}

export function listTables(id: number, database: string, signal?: AbortSignal): Promise<string[]> {
  return fetchList(`${BASE}/${id}/databases/${encodeURIComponent(database)}/tables`, z.string(), {
    signal,
  })
}

export function getTableSchema(
  id: number,
  database: string,
  table: string,
  signal?: AbortSignal,
): Promise<TableSchema> {
  return fetchData(
    `${BASE}/${id}/databases/${encodeURIComponent(database)}/tables/${encodeURIComponent(table)}/schema`,
    tableSchemaSchema,
    { signal },
  )
}

/**
 * `POST /servers/{id}/grantable` 🔌 — comprueba si la credencial pseudo-root puede delegar
 * los privilegios indicados (`WITH GRANT OPTION`). No modifica nada (§6).
 */
export function checkGrantable(
  id: number,
  body: GrantableRequest,
  signal?: AbortSignal,
): Promise<GrantableResult> {
  return mutateData('POST', `${BASE}/${id}/grantable`, grantableResultSchema, { body, signal })
}

// ── Usuarios del motor por identidad física 🔌 ──────────────────────────────
// docs/features/engine-users-management.md — operan por (server_id, username, host) directo
// sobre el motor, adoptados o no. Complementan (no reemplazan) el CRUD de `/server-users`.

/**
 * `GET /servers/{id}/users/grouped` — vista principal: agrupa por username y reconcilia contra
 * el inventario. Lee `supports_hosts` para adaptar la UI a la asimetría MySQL/MariaDB vs
 * PostgreSQL (ROLE sin host).
 */
export function listGroupedEngineUsers(
  id: number,
  signal?: AbortSignal,
): Promise<GroupedEngineUsersOut> {
  return fetchData(`${BASE}/${id}/users/grouped`, groupedEngineUsersOutSchema, { signal })
}

/** `POST /servers/{id}/users` 🔌 — `CREATE USER`. Con `adopt=true` registra la fila de inventario. */
export function createEngineUser(
  id: number,
  body: EngineUserCreateIn,
): Promise<EngineUserMutationOut> {
  return mutateData('POST', `${BASE}/${id}/users`, engineUserMutationOutSchema, { body })
}

/**
 * `PATCH /servers/{id}/users/password` 🔌 — `ALTER USER/ROLE`. Sincroniza la fila de inventario
 * si ya existe; `adopt` solo aplica cuando no había fila previa.
 */
export function changeEngineUserPassword(
  id: number,
  body: EnginePasswordChangeIn,
): Promise<EngineUserMutationOut> {
  return mutateData('PATCH', `${BASE}/${id}/users/password`, engineUserMutationOutSchema, { body })
}

/**
 * `DELETE /servers/{id}/users` 🔌 — `DROP USER/ROLE`. `confirmUsername` debe repetir el
 * username exacto (doble intención); 409 si el usuario posee BDs gestionadas.
 */
export function deleteEngineUser(
  id: number,
  options: { username: string; host?: string; confirmUsername: string },
): Promise<string | undefined> {
  return mutateVoid('DELETE', `${BASE}/${id}/users`, {
    query: {
      username: options.username,
      host: options.host,
      confirm_username: options.confirmUsername,
    },
  })
}

/**
 * `POST /servers/{id}/users/add-host` 🔌 — clona una cuenta a un nuevo host (`CREATE USER`).
 * Solo MySQL/MariaDB (422 en PostgreSQL).
 */
export function addEngineUserHost(id: number, body: AddHostIn): Promise<AddHostOut> {
  return mutateData('POST', `${BASE}/${id}/users/add-host`, addHostOutSchema, { body })
}

// ── Operaciones batch por username (todos los hosts) 🔌 (§7.4) ──────────────
// Fail-tolerant por host: 200/201 con `results[]` — el desenlace real vive AHÍ, no en el
// código HTTP. En PostgreSQL `results[].host` es null.

/**
 * `POST /servers/{id}/users/adopt-all-hosts` 🔌 — adopta TODAS las identidades en vivo de un
 * username (nunca `CREATE USER`). Con `known_password` guarda la contraseña cifrada en todas
 * las filas SIN ejecutar `ALTER USER`.
 */
export function adoptAllHosts(id: number, body: AdoptAllHostsIn): Promise<BatchAdoptOut> {
  return mutateData('POST', `${BASE}/${id}/users/adopt-all-hosts`, batchAdoptOutSchema, { body })
}

/**
 * `POST /servers/{id}/users/define-password` — DEFINE (no rota) una contraseña ya conocida:
 * la cifra y guarda sin tocar el motor. `overwrite=true` es obligatorio para sobrescribir una
 * identidad que ya tenía contraseña guardada (`conflict_needs_overwrite` en `results[]`).
 */
export function defineKnownPassword(
  id: number,
  body: DefineKnownPasswordIn,
): Promise<KnownPasswordSetOut> {
  return mutateData('POST', `${BASE}/${id}/users/define-password`, knownPasswordSetOutSchema, {
    body,
  })
}

/**
 * `PATCH /servers/{id}/users/password-all-hosts` 🔌 — `ALTER USER/ROLE` REAL en todos los
 * hosts en vivo. Un host con `status='error'` conserva la contraseña ANTERIOR en el motor:
 * el resultado siempre se comunica por host, nunca con un éxito genérico.
 */
export function changeEngineUserPasswordAllHosts(
  id: number,
  body: EnginePasswordChangeAllHostsIn,
): Promise<PasswordChangeBatchOut> {
  return mutateData(
    'PATCH',
    `${BASE}/${id}/users/password-all-hosts`,
    passwordChangeBatchOutSchema,
    { body },
  )
}

/**
 * `POST /servers/{id}/users/reveal-password` — solo lectura, pero **auditada**: el gateway
 * únicamente puede revelar una contraseña que él mismo fijó (create/rotación vía gateway).
 */
export function revealEngineUserPassword(
  id: number,
  body: EngineRevealPasswordIn,
): Promise<EngineRevealPasswordOut> {
  return mutateData('POST', `${BASE}/${id}/users/reveal-password`, engineRevealPasswordOutSchema, {
    body,
  })
}

/**
 * `GET /servers/{id}/users/grants` 🔌 (v21 §1) — permisos de una identidad del motor
 * **sin exigir adopción**, a diferencia de `GET /server-users/{id}/grants`, que necesita fila
 * de inventario. Devuelve además el cruce contra ese inventario (`status`, `server_user_id`).
 *
 * `database` **no es simétrico entre motores** (v21 §3): en PostgreSQL es obligatorio —los
 * grants de objeto viven dentro de una BD y hay que conectarse a ella— y acota la respuesta a
 * esa base; en MySQL/MariaDB el backend lo **ignora** y devuelve los grants de todo el servidor,
 * así que acotar por base es tarea del cliente (ver `filterGrantsByDatabase`).
 */
export function listIdentityGrants(
  id: number,
  params: { username: string; host?: string; database?: string },
  signal?: AbortSignal,
): Promise<IdentityGrants> {
  return fetchData(`${BASE}/${id}/users/grants`, identityGrantsSchema, {
    query: { username: params.username, host: params.host, database: params.database },
    signal,
  })
}
