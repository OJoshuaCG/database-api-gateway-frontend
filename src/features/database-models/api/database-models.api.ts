import {
  fetchData,
  fetchList,
  fetchPage,
  mutateData,
  mutateVoid,
  type QueryParams,
} from '@/lib/api/client'
import {
  databaseModelOutSchema,
  fromSnapshotOutSchema,
  modelDatabaseStatusSchema,
  type DatabaseModelCreate,
  type DatabaseModelOut,
  type ModelDatabaseStatus,
  type DatabaseModelUpdate,
  type FromSnapshotIn,
  type FromSnapshotOut,
  type Page,
} from '@/lib/contracts'

const BASE = '/database-models'

/**
 * `POST /database-models/from-snapshot` 🔌 (Plan 09 §6) — crea un blueprint cuyo baseline `0001`
 * es el snapshot estructural de una BD existente. El baseline nace `reviewed=false`.
 */
export function createModelFromSnapshot(body: FromSnapshotIn): Promise<FromSnapshotOut> {
  return mutateData('POST', `${BASE}/from-snapshot`, fromSnapshotOutSchema, { body })
}

export function listDatabaseModels(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<DatabaseModelOut>> {
  return fetchPage(BASE, databaseModelOutSchema, { query: params, signal })
}

export function getDatabaseModel(id: number, signal?: AbortSignal): Promise<DatabaseModelOut> {
  return fetchData(`${BASE}/${id}`, databaseModelOutSchema, { signal })
}

export function createDatabaseModel(body: DatabaseModelCreate): Promise<DatabaseModelOut> {
  return mutateData('POST', BASE, databaseModelOutSchema, { body })
}

export function updateDatabaseModel(
  id: number,
  body: DatabaseModelUpdate,
): Promise<DatabaseModelOut> {
  return mutateData('PATCH', `${BASE}/${id}`, databaseModelOutSchema, { body })
}

export function deleteDatabaseModel(id: number): Promise<string | undefined> {
  return mutateVoid('DELETE', `${BASE}/${id}`)
}

/** BDs que replican este blueprint (§8). */
export function listModelDatabases(
  id: number,
  options: { refresh?: boolean } = {},
  signal?: AbortSignal,
): Promise<ModelDatabaseStatus[]> {
  return fetchList(`${BASE}/${id}/databases`, modelDatabaseStatusSchema, {
    // `refresh` es 🔌: relee la versión real de cada BD y resincroniza la copia del gateway.
    // Sin él la respuesta sale de datos locales y no abre ninguna conexión.
    query: options.refresh ? { refresh: true } : undefined,
    signal,
  })
}
