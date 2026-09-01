import { fetchData, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  cloneBatchItemOutSchema,
  cloneBatchOutSchema,
  cloneBatchRetryOutSchema,
  type CloneBatchCreateIn,
  type CloneBatchExecuteIn,
  type CloneBatchItemOut,
  type CloneBatchOut,
  type CloneBatchRetryOut,
  type Page,
} from '@/lib/contracts'

const BASE = '/database-clone-batches'
const base = (id: number) => `${BASE}/${id}`

/**
 * `POST /database-clone-batches` 🔌 (10/min) — arma el plan del lote.
 *
 * No fotografía ninguna base: solo consulta la lista de bases de cada servidor. Las filas que
 * no se pueden clonar por el estado del servidor NO rebotan la petición: vuelven con
 * `status: 'blocked'` y su `error_code`.
 */
export function createCloneBatch(body: CloneBatchCreateIn): Promise<CloneBatchOut> {
  return mutateData('POST', BASE, cloneBatchOutSchema, { body })
}

/** `GET /database-clone-batches` — historial, del más nuevo al más viejo. */
export function listCloneBatches(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<CloneBatchOut>> {
  return fetchPage(BASE, cloneBatchOutSchema, { query: params, signal })
}

/** `GET /database-clone-batches/{id}` (30/min) — cabecera + `counts`. Latido del polling. */
export function getCloneBatch(id: number, signal?: AbortSignal): Promise<CloneBatchOut> {
  return fetchData(base(id), cloneBatchOutSchema, { signal })
}

/** `GET .../items` — una fila por base, ordenadas por `seq`. */
export function listCloneBatchItems(
  id: number,
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<CloneBatchItemOut>> {
  return fetchPage(`${base(id)}/items`, cloneBatchItemOutSchema, { query: params, signal })
}

/**
 * `POST .../execute` 🔌 (3/min) — confirmación agregada y encolado.
 *
 * Un solo gesto para todo el lote: re-tipear el nombre del SERVIDOR destino. El `confirm_token`
 * ata el conjunto exacto de filas, así que si el lote cambió, la confirmación deja de valer.
 */
export function executeCloneBatch(
  id: number,
  body: CloneBatchExecuteIn,
): Promise<CloneBatchOut> {
  return mutateData('POST', `${base(id)}/execute`, cloneBatchOutSchema, { body })
}

/** `POST .../cancel` — cooperativa; propaga también al job de la fila en curso. */
export function cancelCloneBatch(id: number): Promise<CloneBatchOut> {
  return mutateData('POST', `${base(id)}/cancel`, cloneBatchOutSchema)
}

/** `GET .../retry-candidates` — qué se puede relanzar y qué exige intervención manual. */
export function getCloneBatchRetryCandidates(
  id: number,
  signal?: AbortSignal,
): Promise<CloneBatchRetryOut> {
  return fetchData(`${base(id)}/retry-candidates`, cloneBatchRetryOutSchema, { signal })
}

/** `POST .../retry-failed` 🔌 (3/min) — crea un lote NUEVO, que hay que volver a confirmar. */
export function retryCloneBatch(id: number): Promise<CloneBatchOut> {
  return mutateData('POST', `${base(id)}/retry-failed`, cloneBatchOutSchema)
}
