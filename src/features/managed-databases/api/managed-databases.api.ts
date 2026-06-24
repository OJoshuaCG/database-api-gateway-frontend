import { fetchData, fetchPage, mutateData, mutateVoid, type QueryParams } from '@/lib/api/client'
import {
  managedDatabaseOutSchema,
  type ManagedDatabaseCreate,
  type ManagedDatabaseOut,
  type ManagedDatabaseUpdate,
  type Page,
  type ReassignOwnerIn,
} from '@/lib/contracts'

const BASE = '/managed-databases'

export function listManagedDatabases(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<ManagedDatabaseOut>> {
  return fetchPage(BASE, managedDatabaseOutSchema, { query: params, signal })
}

export function getManagedDatabase(id: number, signal?: AbortSignal): Promise<ManagedDatabaseOut> {
  return fetchData(`${BASE}/${id}`, managedDatabaseOutSchema, { signal })
}

/** `provision=true` 🔌 ejecuta `CREATE DATABASE` + `GRANT` al owner. */
export function createManagedDatabase(
  body: ManagedDatabaseCreate,
  provision: boolean,
): Promise<ManagedDatabaseOut> {
  return mutateData('POST', BASE, managedDatabaseOutSchema, { body, query: { provision } })
}

/** PATCH solo actualiza metadata (no toca el motor). */
export function updateManagedDatabase(
  id: number,
  body: ManagedDatabaseUpdate,
): Promise<ManagedDatabaseOut> {
  return mutateData('PATCH', `${BASE}/${id}`, managedDatabaseOutSchema, { body })
}

/** `drop_remote=true` 🔌 ejecuta `DROP DATABASE` (exige `confirm_name` exacto). */
export function deleteManagedDatabase(
  id: number,
  options: { dropRemote: boolean; confirmName?: string },
): Promise<string | undefined> {
  return mutateVoid('DELETE', `${BASE}/${id}`, {
    query: { drop_remote: options.dropRemote, confirm_name: options.confirmName },
  })
}

/** `provision=true` 🔌 revoca/otorga (o `ALTER OWNER` en PG). */
export function reassignOwner(
  id: number,
  body: ReassignOwnerIn,
  provision: boolean,
): Promise<ManagedDatabaseOut> {
  return mutateData('POST', `${BASE}/${id}/reassign-owner`, managedDatabaseOutSchema, {
    body,
    query: { provision },
  })
}
