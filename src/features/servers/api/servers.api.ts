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
  serverOutSchema,
  tableSchemaSchema,
  type ConnectionInfo,
  type EngineUserInfo,
  type Page,
  type ServerCreate,
  type ServerOut,
  type ServerUpdate,
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
