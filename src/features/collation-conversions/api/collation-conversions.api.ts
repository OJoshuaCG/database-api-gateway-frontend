import { fetchData, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  collationConversionItemOutSchema,
  collationConversionPreviewOutSchema,
  collationConversionSummaryOutSchema,
  collationInventoryOutSchema,
  type CollationConversionCreate,
  type CollationConversionExecuteIn,
  type CollationConversionItemOut,
  type CollationConversionPreviewIn,
  type CollationConversionPreviewOut,
  type CollationConversionSummaryOut,
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
