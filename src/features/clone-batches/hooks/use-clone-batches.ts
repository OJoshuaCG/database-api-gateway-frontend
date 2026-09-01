import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { QueryParams } from '@/lib/api/client'
import { CLONE_BATCH_TERMINAL_STATUSES } from '@/lib/contracts'
import {
  getCloneBatch,
  getCloneBatchRetryCandidates,
  listCloneBatchItems,
  listCloneBatches,
} from '../api/clone-batches.api'

/**
 * Intervalo de polling del lote. **5 s, no los 2 s del clon suelto**, y por dos motivos: el
 * endpoint está limitado a 30/min (2 s lo agotarían con una sola pestaña abierta), y un lote
 * corre durante horas — refrescar más seguido no aporta nada que el operador pueda usar.
 */
const BATCH_POLL_MS = 5000

/** Cabecera + `counts` del lote. Se detiene sola en cualquier estado terminal. */
export function useCloneBatch(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.cloneBatches.detail(id),
    queryFn: ({ signal }) => getCloneBatch(id, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && !CLONE_BATCH_TERMINAL_STATUSES.has(status) ? BATCH_POLL_MS : false
    },
  })
}

/**
 * Filas del lote. `poll` tiene que reflejar si el lote sigue vivo: si no, la lista se congela
 * en la última página cargada mientras el recorrido avanza.
 */
export function useCloneBatchItems(
  id: number,
  params: QueryParams,
  enabled: boolean,
  poll: boolean,
) {
  return useQuery({
    queryKey: queryKeys.cloneBatches.items(id, params),
    queryFn: ({ signal }) => listCloneBatchItems(id, params, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
    placeholderData: keepPreviousData,
    refetchInterval: poll ? BATCH_POLL_MS : false,
  })
}

/** Historial de lotes. */
export function useCloneBatchList(params: QueryParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.cloneBatches.list(params),
    queryFn: ({ signal }) => listCloneBatches(params, signal),
    enabled,
    placeholderData: keepPreviousData,
  })
}

/**
 * Partición del reintento. Solo se pide con el lote YA terminado: antes, "qué se puede
 * reintentar" es una pregunta sin respuesta estable — y además consulta el estado vivo del
 * servidor destino, que es una llamada al motor.
 */
export function useCloneBatchRetryCandidates(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.cloneBatches.retryCandidates(id),
    queryFn: ({ signal }) => getCloneBatchRetryCandidates(id, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
  })
}
