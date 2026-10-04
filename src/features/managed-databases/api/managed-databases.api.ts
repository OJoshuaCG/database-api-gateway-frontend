import { fetchData, fetchPage, mutateData, mutateVoid, type QueryParams } from '@/lib/api/client'
import {
  dataCredentialOutSchema,
  managedDatabaseOutSchema,
  managedDatabaseProvisionOutSchema,
  type AdoptDatabaseIn,
  type AgentAccessIn,
  type DataCredentialOut,
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

/**
 * `PUT /managed-databases/{id}/agent-access` — opt-in y veto de ESTA base al acceso de agentes.
 * Reemplaza el estado completo (los dos campos son obligatorios) y devuelve la base con el estado
 * nuevo. Pide `environments.write` (global, solo security_officer) + step-up.
 */
export function setAgentAccess(id: number, body: AgentAccessIn): Promise<ManagedDatabaseOut> {
  return mutateData('PUT', `${BASE}/${id}/agent-access`, managedDatabaseOutSchema, { body })
}

// ── Lectura de DATOS por agentes (api-reference-v35 / v36) ──────────────────────

/** `GET /managed-databases/{id}/data-credential` — estado de la credencial y del opt-in de datos. */
export function getDataCredential(id: number, signal?: AbortSignal): Promise<DataCredentialOut> {
  return fetchData(`${BASE}/${id}/data-credential`, dataCredentialOutSchema, { signal })
}

/**
 * `POST .../data-credential/provision` 🔌 — sin cuerpo: el gateway crea (o re-converge) la cuenta
 * del motor con `SELECT` sobre ESTA base y nada más. La credencial queda sin verificar. Pide
 * `servers.admin` + step-up. Sin reintentos: rota la contraseña de una cuenta de un tercero.
 */
export function provisionDataCredential(id: number): Promise<DataCredentialOut> {
  return mutateData('POST', `${BASE}/${id}/data-credential/provision`, dataCredentialOutSchema)
}

/**
 * `POST .../data-credential/verify` 🔌 — la sonda negativa: conecta con la cuenta de datos y exige
 * que no pueda más que `SELECT` sobre esta base. 422 `data_probe_failed` con `violations`.
 */
export function verifyDataCredential(id: number): Promise<DataCredentialOut> {
  return mutateData('POST', `${BASE}/${id}/data-credential/verify`, dataCredentialOutSchema)
}

/** `DELETE .../data-credential` 🔌 — palanca de emergencia: borra la cuenta del motor. Idempotente. */
export function clearDataCredential(id: number): Promise<DataCredentialOut> {
  return mutateData('DELETE', `${BASE}/${id}/data-credential`, dataCredentialOutSchema)
}

/** `POST .../data-access/request` — pide abrir la lectura de datos (`data.read` en el entorno). */
export function requestDataAccess(id: number): Promise<DataCredentialOut> {
  return mutateData('POST', `${BASE}/${id}/data-access/request`, dataCredentialOutSchema)
}

/** `POST .../data-access/approve` — aprueba el pedido de OTRO owner (el propio da 403). */
export function approveDataAccess(id: number): Promise<DataCredentialOut> {
  return mutateData('POST', `${BASE}/${id}/data-access/approve`, dataCredentialOutSchema)
}

/** `DELETE .../data-access` — cierra el acceso o cancela el pedido. Inmediato e idempotente. */
export function revokeDataAccess(id: number): Promise<DataCredentialOut> {
  return mutateData('DELETE', `${BASE}/${id}/data-access`, dataCredentialOutSchema)
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
