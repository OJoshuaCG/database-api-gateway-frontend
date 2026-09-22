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
  databaseModelOutSchema,
  fromSnapshotOutSchema,
  renameSlugPlanSchema,
  renameSlugResultSchema,
  versionTablesReportSchema,
  type RenameSlugPlan,
  type RenameSlugResult,
  type VersionTablesReport,
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
  signal?: AbortSignal,
): Promise<ModelDatabaseStatus[]> {
  return fetchList(`${BASE}/${id}/databases`, modelDatabaseStatusSchema, { signal })
}

/**
 * `POST .../databases/refresh` 🔌 — relee la versión real de cada BD y resincroniza la copia
 * del gateway.
 *
 * Es POST y no un parámetro del GET porque **tiene efectos**: abre conexiones a los motores y
 * reescribe `model_version`. Colgarlo del GET además obligaba a limitar por tasa la lectura
 * barata, que es la que hace la UI al reenfocar la ventana.
 */
export function refreshModelDatabases(id: number): Promise<ModelDatabaseStatus[]> {
  return mutateData('POST', `${BASE}/${id}/databases/refresh`, z.array(modelDatabaseStatusSchema))
}

/**
 * `GET /database-models/{id}/version-tables` 🔌 — informe de contabilidad de versiones (v25 §3.4).
 *
 * **No escribe nada, pero abre una conexión por base**, y por eso está limitado a 10/min: se pide
 * por clic explícito, nunca al montar la pantalla. No pagina: devuelve todas las bases del
 * blueprint. Un motor caído no rompe el informe — esa base llega como fila `unreachable` dentro
 * de un 200, así que la vista renderiza el informe completo en vez de un error global.
 */
export function getVersionTablesReport(
  id: number,
  signal?: AbortSignal,
): Promise<VersionTablesReport> {
  return fetchData(`${BASE}/${id}/version-tables`, versionTablesReportSchema, { signal })
}

/**
 * `POST /database-models/{id}/rename-slug/plan` 🔌 — preflight del renombrado (v25 §3.2).
 *
 * Es un POST y está limitado a 10/min **aunque sea una lectura**: abre una conexión por base para
 * preguntar, en cada una, si tiene la tabla de versión vieja y si el nombre nuevo está libre.
 * No escribe nada. Su `confirm_token` es el único insumo de `renameSlug`.
 */
export function planRenameSlug(id: number, newSlug: string): Promise<RenameSlugPlan> {
  return mutateData('POST', `${BASE}/${id}/rename-slug/plan`, renameSlugPlanSchema, {
    body: { new_slug: newSlug },
  })
}

/**
 * `POST /database-models/{id}/rename-slug` 🔌 — ejecución (v25 §3.3). Rate limit **3/min**.
 *
 * Renombra la tabla de versión de cada BD gestionada al nombre del slug nuevo y, **al final**,
 * actualiza el slug del blueprint. El orden importa: si algo falla a mitad se compensa
 * renombrando de vuelta y el slug NO se modifica. Al revés, un fallo remoto dejaría a todo el
 * parque con la contabilidad huérfana a la vez.
 *
 * El token va tal cual viene del plan: se **omite** cuando el plan dio `no_op` o
 * `rename_count: 0`. Mandarlo siempre entrenaría al cliente a mandarlo siempre y vaciaría la
 * confirmación de sentido — mismo criterio que el borrado de versiones.
 */
export function renameSlug(
  id: number,
  newSlug: string,
  confirmToken?: string | null,
): Promise<RenameSlugResult> {
  return mutateData('POST', `${BASE}/${id}/rename-slug`, renameSlugResultSchema, {
    body: confirmToken ? { new_slug: newSlug, confirm_token: confirmToken } : { new_slug: newSlug },
  })
}

/**
 * `POST /database-models/{id}/migrate-version-table/plan` 🔌 — preview de la migración al
 * formato Datum (v25 §2.3). **Sin cuerpo.** Rate limit 10/min.
 *
 * Es el mismo preflight que el renombrado de slug con el slug igual a sí mismo, y por eso
 * devuelve el mismo `RenameSlugPlanOut`, con `prefix_only: true`. No escribe nada.
 */
export function planMigrateVersionTable(id: number): Promise<RenameSlugPlan> {
  return mutateData('POST', `${BASE}/${id}/migrate-version-table/plan`, renameSlugPlanSchema)
}

/**
 * `POST /database-models/{id}/migrate-version-table` 🔌 — ejecución (v25 §2.3). Rate limit
 * **3/min**. Renombra la tabla de versión al prefijo vigente donde haga falta y crea el espejo
 * `_datum_migrations` donde falte, **sin cambiar el slug**.
 *
 * A diferencia de `renameSlug`, acá el token se manda **siempre como clave**, `null` incluido:
 * es el cuerpo que el contrato declara (`{"confirm_token": string|null}`). Y hay un caso
 * legítimo sin token: con `rename_count: 0` el plan no emite uno, pero si hay bases sin espejo
 * igual vale ejecutar.
 */
export function migrateVersionTable(
  id: number,
  confirmToken: string | null,
): Promise<RenameSlugResult> {
  return mutateData('POST', `${BASE}/${id}/migrate-version-table`, renameSlugResultSchema, {
    body: { confirm_token: confirmToken },
  })
}
