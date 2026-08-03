import { z } from 'zod'
import { mutateData, requestJson, type QueryParams } from '@/lib/api/client'
import {
  paginationMetaSchema,
  queryExecuteOutSchema,
  queryHistoryOutSchema,
  queryPreviewOutSchema,
  type Page,
  type QueryExecuteIn,
  type QueryExecuteOut,
  type QueryHistoryOut,
  type QueryPreviewIn,
  type QueryPreviewOut,
} from '@/lib/contracts'

/**
 * Servicios de la Consola SQL (`api-reference-v6.md`).
 *
 * Preview y execute son POST aunque el preview "no cambia nada": puede abrir conexión al
 * motor para estimar impacto y emite un token de un solo uso, así que no debe cachearse ni
 * refetchearse. Por eso ambos se consumen como mutaciones, nunca como queries.
 */

const BASE = '/servers'

function queryPath(serverId: number, action: string): string {
  return `${BASE}/${serverId}/query/${action}`
}

/**
 * Clasifica el SQL, estima el impacto y emite el `confirm_token`. NO ejecuta el SQL del
 * usuario. Rate limit 30/min: no llamarlo por pulsación.
 */
export function previewQuery(serverId: number, body: QueryPreviewIn): Promise<QueryPreviewOut> {
  return mutateData('POST', queryPath(serverId, 'preview'), queryPreviewOutSchema, { body })
}

/**
 * Ejecuta el lote. Rate limit 30/min.
 *
 * Un rechazo del motor NO lanza: llega como HTTP 200 con `success: false` (o
 * `connection_error`) porque, cuando se está probando un permiso, ese rechazo es el
 * resultado buscado. Solo lanzan los errores reales de la API (403/404/409/410/422/429/5xx).
 */
export function executeQuery(serverId: number, body: QueryExecuteIn): Promise<QueryExecuteOut> {
  return mutateData('POST', queryPath(serverId, 'execute'), queryExecuteOutSchema, { body })
}

/**
 * Envelope tolerante del historial.
 *
 * El contrato v6 §7 describe la paginación como "estándar del gateway" pero nombra la clave
 * `meta` (`meta.total`, `meta.page`, `meta.size`), mientras el resto de la API usa
 * `pagination` con los seis campos. Como el módulo aún no se validó contra motores reales
 * (§2.8), se aceptan las dos formas y se derivan los campos que falten: fallar aquí dejaría
 * la pantalla de historial inservible por una discrepancia de nombre.
 */
const historyMetaSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  size: z.number().int(),
  pages: z.number().int().optional(),
  has_next: z.boolean().optional(),
  has_prev: z.boolean().optional(),
})

const historyEnvelopeSchema = z.object({
  data: z.array(queryHistoryOutSchema),
  message: z.string().optional(),
  pagination: paginationMetaSchema.optional(),
  meta: historyMetaSchema.optional(),
})

export interface QueryHistoryParams extends QueryParams {
  page: number
  size: number
  /** Filtra por nombre EXACTO de base de datos. */
  database?: string | null
}

/** Bitácora paginada de ejecuciones del servidor. No toca el motor. Rate limit 60/min. */
export async function listQueryHistory(
  serverId: number,
  params: QueryHistoryParams,
  signal?: AbortSignal,
): Promise<Page<QueryHistoryOut>> {
  const result = await requestJson('GET', queryPath(serverId, 'history'), historyEnvelopeSchema, {
    query: params,
    signal,
  })

  if (result.pagination) return { items: result.data, pagination: result.pagination }

  const meta = result.meta
  const size = meta?.size ?? params.size
  const page = meta?.page ?? params.page
  const total = meta?.total ?? result.data.length
  const pages = meta?.pages ?? (size > 0 ? Math.max(1, Math.ceil(total / size)) : 1)
  return {
    items: result.data,
    pagination: {
      page,
      size,
      total,
      pages,
      has_next: meta?.has_next ?? page < pages,
      has_prev: meta?.has_prev ?? page > 1,
    },
  }
}
