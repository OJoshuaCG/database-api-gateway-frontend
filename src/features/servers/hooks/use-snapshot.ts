import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { getDatabaseSnapshot } from '../api/servers.api'

/**
 * Snapshot estructural de una BD (Plan 09 §5). Se carga bajo demanda (al abrir el visor): el
 * `enabled` controla cuándo dispararlo. Solo estructura, nunca filas.
 */
export function useDatabaseSnapshot(serverId: number, database: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.servers.snapshot(serverId, database ?? ''),
    queryFn: ({ signal }) => getDatabaseSnapshot(serverId, database ?? '', signal),
    enabled: enabled && Number.isFinite(serverId) && serverId > 0 && Boolean(database),
    staleTime: 30_000,
  })
}
