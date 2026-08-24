import { fetchData, fetchPage, mutateData, mutateVoid, type QueryParams } from '@/lib/api/client'
import {
  managedDatabaseOutSchema,
  managedDatabaseProvisionOutSchema,
  type AdoptDatabaseIn,
  type ManagedDatabaseCreate,
  type ManagedDatabaseOut,
  type ManagedDatabaseProvisionOut,
  type ManagedDatabaseUpdate,
  type Page,
  type ReassignOwnerIn,
} from '@/lib/contracts'

const BASE = '/managed-databases'

/**
 * `POST /managed-databases/adopt` 🔌 (Plan 09 §3) — registra una BD **ya existente** en el motor
 * sin recrearla (verifica que exista; nunca ejecuta `CREATE DATABASE`). Queda `origin=adopted`.
 */
export function adoptDatabase(body: AdoptDatabaseIn): Promise<ManagedDatabaseOut> {
  return mutateData('POST', `${BASE}/adopt`, managedDatabaseOutSchema, { body })
}

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

/**
 * `POST /managed-databases/{id}/provision` 🔌 — ejecuta el `CREATE DATABASE` que faltaba sobre
 * una fila YA registrada (`pending`, o `error` si el DDL del alta falló), sin tener que
 * borrarla y volver a crearla (lo que perdería notas, entorno, blueprint e historial).
 *
 * No aplica las migraciones del blueprint ni otorga privilegios.
 *
 * `allowRecreate` solo hace falta cuando el inventario ya la marca `active`: es el caso de una
 * base borrada por fuera del gateway. Sin ese gesto explícito el backend responde 409, para no
 * enmascarar ese borrado con un CREATE silencioso.
 */
export function provisionManagedDatabase(
  id: number,
  options: { allowRecreate?: boolean } = {},
): Promise<ManagedDatabaseProvisionOut> {
  return mutateData('POST', `${BASE}/${id}/provision`, managedDatabaseProvisionOutSchema, {
    query: { allow_recreate: options.allowRecreate ?? false },
  })
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
