import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { QueryParams } from '@/lib/api/client'
import { listServers, getServer } from '../api/servers.api'

/** Lista paginada de servidores. Mantiene la página previa mientras carga la nueva. */
export function useServers(params: QueryParams) {
  return useQuery({
    queryKey: queryKeys.servers.list(params),
    queryFn: ({ signal }) => listServers(params, signal),
    placeholderData: keepPreviousData,
  })
}

/** Detalle de un servidor. */
export function useServer(id: number) {
  return useQuery({
    queryKey: queryKeys.servers.detail(id),
    queryFn: ({ signal }) => getServer(id, signal),
  })
}
