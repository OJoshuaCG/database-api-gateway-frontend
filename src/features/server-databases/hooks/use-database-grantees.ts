import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { listDatabaseGrantees } from '../api/server-databases.api'

/**
 * Usuarios/roles del motor con permisos sobre UNA base de datos 🔌.
 *
 * Sin `refetchInterval`: el endpoint está limitado a 30/min y la respuesta es una foto del
 * catálogo del motor, no un estado que convenga vigilar. La recarga es manual (botón
 * «Actualizar») o al entrar a la vista.
 */
export function useDatabaseGrantees(serverId: number, database: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.servers.databaseGrantees(serverId, database ?? ''),
    queryFn: ({ signal }) => listDatabaseGrantees(serverId, database ?? '', signal),
    enabled: enabled && Number.isFinite(serverId) && serverId > 0 && Boolean(database),
    staleTime: 30_000,
  })
}
