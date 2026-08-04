import { fetchData, mutateData } from '@/lib/api/client'
import {
  databaseCreateOutSchema,
  databaseDropOutSchema,
  databaseGranteesOutSchema,
  dropPreviewOutSchema,
  type DatabaseCreateIn,
  type DatabaseCreateOut,
  type DatabaseDropIn,
  type DatabaseDropOut,
  type DatabaseGranteesOut,
  type DropPreviewOut,
} from '@/lib/contracts'

/**
 * Ciclo de vida de BDs a nivel servidor 🔌. Todos los endpoints operan por identidad física
 * `(server_id, database)` y NINGUNO está paginado. El nombre de la BD viaja en el path y puede
 * contener caracteres legados (`$`, `.`, `-`), así que va siempre `encodeURIComponent`.
 *
 * El listado de las BDs físicas del servidor NO vive aquí: ya existe como
 * `listServerDatabases` en `features/servers/api/servers.api.ts` (`GET /servers/{id}/databases`).
 */
const BASE = '/servers'

function databasePath(serverId: number, database: string): string {
  return `${BASE}/${serverId}/databases/${encodeURIComponent(database)}`
}

/**
 * `POST /servers/{id}/databases` 🔌 — ejecuta `CREATE DATABASE` en el motor. Con `register:true`
 * además registra la BD en el inventario (delegando en el mismo controller que
 * `POST /managed-databases?provision=true`), lo que exige `owner_id`.
 *
 * ⚠️ Con `register:true` el inventario inserta la fila ANTES de tocar el motor: si el CREATE
 * falla, queda una fila en estado `error` que hay que revisar en `/managed-databases`.
 * Límite: 10/min.
 */
export function createServerDatabase(
  serverId: number,
  body: DatabaseCreateIn,
): Promise<DatabaseCreateOut> {
  return mutateData('POST', `${BASE}/${serverId}/databases`, databaseCreateOutSchema, { body })
}

/**
 * `POST /servers/{id}/databases/{db}/drop-preview` 🔌 — paso 1 del borrado. NO borra nada:
 * cuenta conexiones activas, cruza con el inventario y emite un `confirm_token` con TTL de 2
 * minutos. Es una mutación (no una query) a propósito: emite un token de un solo uso, está
 * limitada a 10/min y no debe reinvocarse por refetch automático ni al recuperar el foco.
 */
export function dropDatabasePreview(serverId: number, database: string): Promise<DropPreviewOut> {
  return mutateData(
    'POST',
    `${databasePath(serverId, database)}/drop-preview`,
    dropPreviewOutSchema,
  )
}

/**
 * `DELETE /servers/{id}/databases/{db}` 🔌 ⚠️ IRREVERSIBLE — paso 2. Exige el nombre exacto y un
 * `confirm_token` vigente del preview. Si la BD estaba en el inventario, borra también su fila.
 *
 * ⚠️ NO es idempotente de forma segura: nunca reintentar automáticamente, ni ante timeout (un
 * 504 puede significar que el DROP se ejecutó y se perdió la respuesta). Límite: 3/min.
 */
export function dropServerDatabase(
  serverId: number,
  database: string,
  body: DatabaseDropIn,
): Promise<DatabaseDropOut> {
  return mutateData('DELETE', databasePath(serverId, database), databaseDropOutSchema, { body })
}

/**
 * `GET /servers/{id}/databases/{db}/users` 🔌 — consulta INVERSA: los usuarios/roles del motor
 * con algún privilegio sobre esta BD, cruzados con el inventario. Sin paginación ni filtros:
 * la lista completa llega ordenada por `(username, host)`. Límite: 30/min (no hacer polling).
 */
export function listDatabaseGrantees(
  serverId: number,
  database: string,
  signal?: AbortSignal,
): Promise<DatabaseGranteesOut> {
  return fetchData(`${databasePath(serverId, database)}/users`, databaseGranteesOutSchema, {
    signal,
  })
}
