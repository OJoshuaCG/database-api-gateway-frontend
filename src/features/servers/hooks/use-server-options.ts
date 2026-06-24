import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { ServerOut } from '@/lib/contracts'
import { listServers } from '../api/servers.api'

/** Lista (casi) completa de servidores para poblar selects. */
export function useServerOptions() {
  return useQuery({
    queryKey: queryKeys.servers.list({ options: 'all' }),
    queryFn: ({ signal }) => listServers({ page: 1, size: 200 }, signal),
    staleTime: 60_000,
    select: (page): ServerOut[] => page.items,
  })
}
