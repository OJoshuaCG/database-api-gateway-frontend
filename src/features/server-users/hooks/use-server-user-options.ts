import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { PAGINATION, type ServerUserOut } from '@/lib/contracts'
import { listServerUsers } from '../api/server-users.api'

/** Usuarios de un servidor para poblar selects de propietario (owner). */
export function useServerUserOptions(serverId: number | null) {
  return useQuery({
    queryKey: queryKeys.serverUsers.list({ options: 'all', server_id: serverId ?? 0 }),
    queryFn: ({ signal }) =>
      listServerUsers(
        { page: 1, size: PAGINATION.maxSize, server_id: serverId ?? undefined },
        signal,
      ),
    enabled: Boolean(serverId),
    staleTime: 60_000,
    select: (page): ServerUserOut[] => page.items,
  })
}
