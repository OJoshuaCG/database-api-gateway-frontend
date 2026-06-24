import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { QueryParams } from '@/lib/api/client'
import { getServerUser, listOwnedDatabases, listServerUsers } from '../api/server-users.api'

export function useServerUsers(params: QueryParams) {
  return useQuery({
    queryKey: queryKeys.serverUsers.list(params),
    queryFn: ({ signal }) => listServerUsers(params, signal),
    placeholderData: keepPreviousData,
  })
}

export function useServerUser(id: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.serverUsers.detail(id),
    queryFn: ({ signal }) => getServerUser(id, signal),
    enabled,
  })
}

export function useOwnedDatabases(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.serverUsers.databases(id),
    queryFn: ({ signal }) => listOwnedDatabases(id, signal),
    enabled,
  })
}
