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
  connectionInfoSchema,
  engineRevealPasswordOutSchema,
  engineUserMutationOutSchema,
  grantableResultSchema,
  groupedEngineUsersOutSchema,
  reconcileResultSchema,
  serverOutSchema,
  structureDumpSchema,
  tableSchemaSchema,
  type AddHostIn,
  type AddHostOut,
  type ConnectionInfo,
  type EnginePasswordChangeIn,
  type EngineRevealPasswordIn,
  type EngineRevealPasswordOut,
  type EngineUserCreateIn,
  type EngineUserMutationOut,
  type GrantableRequest,
  type GrantableResult,
  type GroupedEngineUsersOut,
  type Page,
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

/**
 * `POST /servers/{id}/users/reveal-password` — solo lectura, pero **auditada**: el gateway
 * únicamente puede revelar una contraseña que él mismo fijó (create/rotación vía gateway).
 */
export function revealEngineUserPassword(
  id: number,
  body: EngineRevealPasswordIn,
): Promise<EngineRevealPasswordOut> {
  return mutateData(
    'POST',
    `${BASE}/${id}/users/reveal-password`,
    engineRevealPasswordOutSchema,
    { body },
  )
}
