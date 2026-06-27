import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { EngineType } from '@/lib/contracts'
import { listPermissionProfiles } from '../api/permission-profiles.api'

/** Perfiles de permisos (opcionalmente filtrados por motor) para poblar selects. */
export function usePermissionProfileOptions(engine?: EngineType | null) {
  return useQuery({
    queryKey: queryKeys.permissionProfiles.list({ options: 'all', engine: engine ?? undefined }),
    queryFn: ({ signal }) =>
      listPermissionProfiles({ engine: engine ?? undefined, active: true }, signal),
    staleTime: 60_000,
  })
}
