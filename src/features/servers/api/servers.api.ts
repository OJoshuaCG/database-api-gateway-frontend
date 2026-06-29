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
  connectionInfoSchema,
  engineUserInfoSchema,
  grantableResultSchema,
  reconcileResultSchema,
  serverOutSchema,
  structureDumpSchema,
  tableSchemaSchema,
  type ConnectionInfo,
  type EngineUserInfo,
  type GrantableRequest,
  type GrantableResult,
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

export function listEngineUsers(id: number, signal?: AbortSignal): Promise<EngineUserInfo[]> {
  return fetchList(`${BASE}/${id}/users`, engineUserInfoSchema, { signal })
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
 * en orden de dependencia. Solo estructura, nunca filas.
 */
export function getDatabaseSnapshot(
  id: number,
  database: string,
  signal?: AbortSignal,
): Promise<StructureDump> {
  return fetchData(
    `${BASE}/${id}/databases/${encodeURIComponent(database)}/snapshot`,
    structureDumpSchema,
    { signal },
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
