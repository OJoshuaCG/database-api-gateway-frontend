import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { listQueryHistory, type QueryHistoryParams } from '../api/sql-console.api'

/**
 * Bitácora paginada de ejecuciones de un servidor.
 *
 * `keepPreviousData` evita que la tabla parpadee al paginar. `staleTime` corto porque cada
 * ejecución añade una fila: el propio `useExecuteQuery` invalida esta key al terminar.
 */
export function useQueryHistory(serverId: number, params: QueryHistoryParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.sqlConsole.history(serverId, params),
    queryFn: ({ signal }) => listQueryHistory(serverId, params, signal),
    enabled: enabled && Number.isFinite(serverId) && serverId > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}
