import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { reconcileServer } from '../api/servers.api'

/**
 * Reconciliación de un servidor (Plan 09 §2): cruza el motor en vivo con el inventario. Solo
 * lectura. `staleTime` corto porque refleja el estado real del motor, que puede cambiar por fuera.
 */
export function useReconcile(serverId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.servers.reconcile(serverId),
    queryFn: ({ signal }) => reconcileServer(serverId, signal),
    enabled: enabled && Number.isFinite(serverId) && serverId > 0,
    staleTime: 10_000,
  })
}
