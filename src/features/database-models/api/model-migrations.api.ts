import { fetchData, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  applyAllResultSchema,
  migrationDeletePlanOutSchema,
  migrationDeleteResultSchema,
  migrationEditPreviewOutSchema,
  migrationValidateOutSchema,
  modelMigrationOutSchema,
  modelMigrationSummarySchema,
  type ApplyAllResult,
  type MigrationDeletePlanOut,
  type MigrationDeleteResult,
  type MigrationValidateIn,
  type MigrationValidateOut,
  type ModelMigrationCreate,
  type ModelMigrationOut,
  type MigrationEditPreviewIn,
  type MigrationEditPreviewOut,
  type ModelMigrationPatch,
  type ModelMigrationSummary,
  type OnFailureMode,
  type Page,
} from '@/lib/contracts'

const base = (modelId: number) => `/database-models/${modelId}/migrations`

/** `GET .../migrations` — lista paginada de resúmenes (§8). */
export function listModelMigrations(
  modelId: number,
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<ModelMigrationSummary>> {
  return fetchPage(base(modelId), modelMigrationSummarySchema, { query: params, signal })
}

/** `GET .../migrations/{version}` — detalle completo (§8). */
export function getModelMigration(
  modelId: number,
  version: string,
  signal?: AbortSignal,
): Promise<ModelMigrationOut> {
  return fetchData(`${base(modelId)}/${encodeURIComponent(version)}`, modelMigrationOutSchema, {
    signal,
  })
}

/** `POST .../migrations` — crea una migración; devuelve `translated` + `down_sql_suggested` (§8). */
export function createModelMigration(
  modelId: number,
  body: ModelMigrationCreate,
): Promise<ModelMigrationOut> {
  return mutateData('POST', base(modelId), modelMigrationOutSchema, { body })
}

/** `PATCH .../migrations/{version}` — confirma `down_sql` / añade overrides (§8). */
export function updateModelMigration(
  modelId: number,
  version: string,
  body: ModelMigrationPatch,
): Promise<ModelMigrationOut> {
  return mutateData(
    'PATCH',
    `${base(modelId)}/${encodeURIComponent(version)}`,
    modelMigrationOutSchema,
    {
      body,
    },
  )
}

/**
 * `GET .../migrations/{version}/delete-plan` (api-reference-v18 §2) — paso 1 del borrado de una
 * versión **intermedia**.
 *
 * Es un GET y no modifica nada, pero **abre conexión a cada BD del blueprint** para leer en qué
 * versión está parada de verdad. Por eso su veredicto es autoritativo y las banderas del listado
 * (`deletable`, `delete_requires_stamps`) son solo una pista de caché para elegir el diálogo.
 *
 * Devuelve el renumerado del blueprint, los punteros que habría que mover en BDs reales
 * (`stamp_plan` 🔌) y, si hace falta confirmar, el `confirm_token` que autoriza el DELETE. Ese
 * token vive **2 minutos**: no se guarda para «después», se pide y se usa.
 */
export function getModelMigrationDeletePlan(
  modelId: number,
  version: string,
  signal?: AbortSignal,
): Promise<MigrationDeletePlanOut> {
  return fetchData(
    `${base(modelId)}/${encodeURIComponent(version)}/delete-plan`,
    migrationDeletePlanOutSchema,
    { signal },
  )
}

/**
 * `DELETE .../migrations/{version}` 🔌 (api-reference-v18 §3) — borra la versión, renumera el
 * blueprint y, si el plan lo exige, **mueve punteros de versión en BDs reales**.
 *
 * `confirmToken` sale del `delete-plan` y es obligatorio **solo** cuando el plan mueve punteros;
 * mandarlo cuando no hace falta entrena al cliente a mandarlo siempre y vacía la confirmación de
 * sentido. Va como query param, y `buildUrl` descarta el `undefined`, así que un token ausente no
 * llega a la URL como la cadena "undefined".
 *
 * El schema es `.nullable().optional()` y eso es compatibilidad, no adorno: un gateway anterior a
 * v18 responde sin cuerpo útil para el borrado de la punta —y `ApiResponse` **omite del envelope**
 * las claves nulas de primer nivel, así que ese `data: null` llega directamente como clave
 * ausente—. Con un schema estricto, un borrado que el backend YA ejecutó terminaría en «La API
 * devolvió una respuesta inesperada.», que es el peor modo de fallo posible: la operación
 * destructiva pasó y el operador no ve qué hizo. Un `null` de vuelta significa «se borró, el
 * gateway no cuenta el detalle», no «no se borró».
 */
export function deleteModelMigration(
  modelId: number,
  version: string,
  confirmToken?: string | null,
): Promise<MigrationDeleteResult | null> {
  return mutateData(
    'DELETE',
    `${base(modelId)}/${encodeURIComponent(version)}`,
    migrationDeleteResultSchema.nullable().optional(),
    { query: { confirm_token: confirmToken ?? undefined } },
  ).then((result) => result ?? null)
}

export interface ApplyAllOptions {
  maxDatabases?: number
  /**
   * Destinos concretos. Sin él se aplica a TODAS las BDs del blueprint (hasta `maxDatabases`).
   * Un id que no pertenezca al blueprint devuelve 422 con la lista: es la frontera que impide
   * aplicar sus migraciones a una BD ajena.
   */
  databaseIds?: number[]
  /**
   * Acota el lote a un entorno. Es lo que convierte "aplicá a todo" en "aplicá a desarrollo": el
   * backend lo filtra ANTES del tope, así que `maxDatabases` no se consume con BDs de otros
   * entornos. Combinado con `databaseIds`, un id fuera del entorno devuelve 422 con la lista en
   * vez de desaparecer del lote en silencio.
   */
  environmentId?: number
  force?: boolean
  dryRun?: boolean
  /** Manejo del fallo a mitad de una migración multi-sentencia (§9; solo MySQL/MariaDB). */
  onFailure?: OnFailureMode
}

/** `POST .../migrations/apply-all` 🔌 — aplica a todas las BDs del blueprint (rate limit 3/min). */
export function applyAllMigrations(
  modelId: number,
  options: ApplyAllOptions = {},
): Promise<ApplyAllResult> {
  return mutateData('POST', `${base(modelId)}/apply-all`, applyAllResultSchema, {
    query: {
      max_databases: options.maxDatabases,
      database_ids: options.databaseIds,
      environment_id: options.environmentId,
      force: options.force,
      dry_run: options.dryRun,
      on_failure: options.onFailure,
    },
  })
}

/**
 * `POST .../migrations/validate` — analiza el SQL ANTES de aplicarlo (api-reference-v11 §1).
 *
 * Sin `managed_database_id` es análisis estático y no toca ningún motor. Con él se comprueba
 * además contra el catálogo de esa BD que las tablas referenciadas existan — es lo único que
 * detecta un `ALTER TABLE` sobre una tabla inexistente, que es sintácticamente válido.
 */
export function validateModelMigration(
  modelId: number,
  body: MigrationValidateIn,
  signal?: AbortSignal,
): Promise<MigrationValidateOut> {
  return mutateData('POST', `${base(modelId)}/validate`, migrationValidateOutSchema, {
    body,
    signal,
  })
}

/**
 * `POST .../migrations/{version}/edit-preview` 🔌 (api-reference-v15 §3) — paso 1 de la vía de
 * excepción para editar una versión **ya aplicada**.
 *
 * Lee la versión de cada BD **del motor en vivo**, no de la caché del inventario: por eso abre
 * conexiones y por eso tiene rate limit (20/min). Devuelve a quién va a dejar divergente y, si
 * hace falta confirmar, el `confirm_token` que autoriza el PATCH.
 *
 * ⚠️ El cuerpo tiene que ser **exactamente el mismo** que después va al PATCH: el checksum
 * resultante se calcula por presencia de clave, así que una clave de más o de menos invalida el
 * token. Un 502/504 aquí no es «una BD ilegible» —eso viaja como `reason: "unreadable"` dentro de
 * `blocking_databases`— sino un fallo de la llamada entera: sin token, el flujo no puede seguir.
 */
export function previewModelMigrationEdit(
  modelId: number,
  version: string,
  body: MigrationEditPreviewIn,
): Promise<MigrationEditPreviewOut> {
  return mutateData(
    'POST',
    `${base(modelId)}/${encodeURIComponent(version)}/edit-preview`,
    migrationEditPreviewOutSchema,
    { body },
  )
}
