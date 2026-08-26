import { fetchData, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  collationBatchExecuteOutSchema,
  collationBatchPlanOutSchema,
  collationBatchStatusOutSchema,
  collationBlueprintVersionOutSchema,
  collationConversionItemOutSchema,
  collationConversionPreviewOutSchema,
  collationConversionSummaryOutSchema,
  collationDriftOutSchema,
  collationInventoryOutSchema,
  type CollationBatchCreate,
  type CollationBatchExecuteIn,
  type CollationBatchExecuteOut,
  type CollationBatchPlanOut,
  type CollationBatchStatusOut,
  type CollationBlueprintVersionIn,
  type CollationBlueprintVersionOut,
  type CollationConversionCreate,
  type CollationConversionExecuteIn,
  type CollationConversionItemOut,
  type CollationConversionPreviewIn,
  type CollationConversionPreviewOut,
  type CollationConversionSummaryOut,
  type CollationDriftOut,
  type CollationInventoryOut,
  type Page,
} from '@/lib/contracts'

const BASE = '/collation-conversions'
const base = (id: number) => `${BASE}/${id}`

/**
 * `POST /servers/{serverId}/databases/{database}/collation-conversions` 🔌 (10/min) — fotografía
 * el charset/collation actual de la BD y persiste el plan `pending`.
 */
export function createCollationConversion(
  serverId: number,
  database: string,
  body: CollationConversionCreate,
): Promise<CollationConversionSummaryOut> {
  return mutateData(
    'POST',
    `/servers/${serverId}/databases/${encodeURIComponent(database)}/collation-conversions`,
    collationConversionSummaryOutSchema,
    { body },
  )
}

/** `GET /collation-conversions/{id}` — resumen + estado del job (latido del polling). */
export function getCollationConversion(
  id: number,
  signal?: AbortSignal,
): Promise<CollationConversionSummaryOut> {
  return fetchData(base(id), collationConversionSummaryOutSchema, { signal })
}

/** `GET .../objects` 🔌 (10/min) — inventario bajo demanda: tablas, objetos y collations disponibles. */
export function getCollationConversionObjects(
  id: number,
  signal?: AbortSignal,
): Promise<CollationInventoryOut> {
  return fetchData(`${base(id)}/objects`, collationInventoryOutSchema, { signal })
}

/**
 * `POST .../preview` 🔌 (10/min) — plan resuelto SIN ejecutar. Devuelve el `confirm_token`
 * autoritativo para `execute`.
 */
export function previewCollationConversion(
  id: number,
  body: CollationConversionPreviewIn,
  signal?: AbortSignal,
): Promise<CollationConversionPreviewOut> {
  return mutateData('POST', `${base(id)}/preview`, collationConversionPreviewOutSchema, {
    body,
    signal,
  })
}

/** `POST .../execute` 🔌 (3/min) — valida y ENCOLA el job asíncrono (no ejecuta en la request). */
export function executeCollationConversion(
  id: number,
  body: CollationConversionExecuteIn,
): Promise<CollationConversionSummaryOut> {
  return mutateData('POST', `${base(id)}/execute`, collationConversionSummaryOutSchema, { body })
}

/** `GET .../items` — pasos ejecutados, paginados y ordenados por `seq`. */
export function listCollationConversionItems(
  id: number,
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<CollationConversionItemOut>> {
  return fetchPage(`${base(id)}/items`, collationConversionItemOutSchema, {
    query: params,
    signal,
  })
}

/** `POST .../cancel` — cancelación cooperativa; el worker corta en el próximo punto seguro. */
export function cancelCollationConversion(id: number): Promise<CollationConversionSummaryOut> {
  return mutateData('POST', `${base(id)}/cancel`, collationConversionSummaryOutSchema, {})
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lote por blueprint, versión de contabilidad y deriva (v17)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Estas rutas cuelgan de `/database-models/{modelId}` pero el dominio es de esta feature —el
// mismo criterio por el que `createCollationConversion` vive acá aunque su ruta cuelgue de
// `/servers/...`: la BD se identifica por dónde vive, la operación es de conversión.

const batchBase = (modelId: number) => `/database-models/${modelId}/collation-conversions`
const batch = (modelId: number, batchId: number) => `${batchBase(modelId)}/${batchId}`

/**
 * `POST /database-models/{modelId}/collation-conversions` 🔌 (10/min) — planifica el lote:
 * crea y previsualiza UN job por BD activa del blueprint.
 *
 * Toca el motor una vez por BD, de ahí el rate limit. Solo entran las `status=active`: una
 * `pending` no existe en el motor, una `error` está en cuarentena y una `archived` se retiró.
 */
export function planCollationBatch(
  modelId: number,
  body: CollationBatchCreate,
): Promise<CollationBatchPlanOut> {
  return mutateData('POST', batchBase(modelId), collationBatchPlanOutSchema, { body })
}

/**
 * `POST .../{batchId}/execute` 🔌 (3/min) — confirma y ENCOLA.
 *
 * Devuelve **200 aunque alguna BD se rechace**: esos rechazos viajan en `results[].ok`. Un
 * rechazo del LOTE (slug, conjunto, re-tipeo, token, estado) es 422/409 y no encola nada.
 */
export function executeCollationBatch(
  modelId: number,
  batchId: number,
  body: CollationBatchExecuteIn,
): Promise<CollationBatchExecuteOut> {
  return mutateData('POST', `${batch(modelId, batchId)}/execute`, collationBatchExecuteOutSchema, {
    body,
  })
}

/** `GET .../{batchId}` (30/min) — latido del polling del lote. No paginado. */
export function getCollationBatch(
  modelId: number,
  batchId: number,
  signal?: AbortSignal,
): Promise<CollationBatchStatusOut> {
  return fetchData(batch(modelId, batchId), collationBatchStatusOutSchema, { signal })
}

/**
 * `POST .../{batchId}/cancel` (10/min) — devuelve la misma forma que el polling.
 *
 * Las BDs en cola no llegan a tocar el motor. La que está convirtiendo termina su paso y corta
 * en el próximo punto seguro: matar un `ALTER TABLE` a mitad dejaría la tabla a medio reescribir.
 */
export function cancelCollationBatch(
  modelId: number,
  batchId: number,
): Promise<CollationBatchStatusOut> {
  return mutateData('POST', `${batch(modelId, batchId)}/cancel`, collationBatchStatusOutSchema, {})
}

/**
 * `POST .../{batchId}/blueprint-version` (3/min) — versión de contabilidad de algo YA ocurrido.
 *
 * **Se crea y se STAMPEA, nunca se aplica.** Mostrar el `note` de la respuesta tal cual.
 */
export function createCollationBlueprintVersion(
  modelId: number,
  batchId: number,
  body: CollationBlueprintVersionIn,
): Promise<CollationBlueprintVersionOut> {
  return mutateData(
    'POST',
    `${batch(modelId, batchId)}/blueprint-version`,
    collationBlueprintVersionOutSchema,
    { body },
  )
}

/**
 * `GET /database-models/{modelId}/collation-drift` — deriva declarada vs. inventario.
 *
 * **Sin rate limit y sin 🔌: no abre ninguna conexión al motor.** Por eso `source_note` avisa que
 * es una lectura de la caché del gateway y hay que mostrarlo textual.
 */
export function getCollationDrift(
  modelId: number,
  signal?: AbortSignal,
): Promise<CollationDriftOut> {
  return fetchData(`/database-models/${modelId}/collation-drift`, collationDriftOutSchema, {
    signal,
  })
}
