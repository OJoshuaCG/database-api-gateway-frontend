import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { getDatabaseSnapshot } from '../api/servers.api'

/**
 * Snapshot estructural de una BD (Plan 09 §5). Se carga bajo demanda (al abrir el visor): el
 * `enabled` controla cuándo dispararlo. Con `includeDataStats=true` agrega `table_stats` (más
 * lento) para el paso de datos-semilla; cada variante se cachea por separado. Solo estructura,
 * nunca filas.
 */
export function useDatabaseSnapshot(
  serverId: number,
  database: string | null,
  enabled = true,
  includeDataStats = false,
) {
  return useQuery({
    queryKey: queryKeys.servers.snapshot(serverId, database ?? '', includeDataStats),
    queryFn: ({ signal }) =>
      getDatabaseSnapshot(serverId, database ?? '', { includeDataStats, signal }),
    enabled: enabled && Number.isFinite(serverId) && serverId > 0 && Boolean(database),
    staleTime: 30_000,
    // Al alternar `includeDataStats` (nueva query key) conserva la estructura ya cargada para no
    // parpadear: el explorador sigue visible mientras llegan las estadísticas.
    placeholderData: keepPreviousData,
  })
}
