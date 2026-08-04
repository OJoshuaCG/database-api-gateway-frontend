import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { PAGINATION } from '@/lib/contracts'
import { listManagedDatabases } from '@/features/managed-databases/api/managed-databases.api'
import { listServerDatabases } from '@/features/servers/api/servers.api'
import { crossWithInventory, type ServerDatabaseRow } from '../logic'

/**
 * Listado de la Vista 1: las BDs que existen FÍSICAMENTE en el motor, cruzadas con el
 * inventario del gateway.
 *
 * Son dos peticiones independientes a propósito: si el inventario falla, la tabla sigue siendo
 * útil (se muestra con un aviso en línea de que no se pudo cruzar) en vez de caerse entera.
 */

/** Nombres físicos del motor. Mismo key que `useServerDatabases` de introspección: cache compartida. */
function usePhysicalDatabases(serverId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.servers.databases(serverId),
    queryFn: ({ signal }) => listServerDatabases(serverId, signal),
    enabled: enabled && Number.isFinite(serverId) && serverId > 0,
  })
}

/**
 * Inventario del servidor. Comparte key y `queryFn` con `useManagedDatabasesByServer` (misma
 * entrada de caché, sin request extra), pero sin su `select` para conservar `pagination` y
 * poder detectar el truncamiento.
 */
function useServerInventory(serverId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.managedDatabases.list({ options: 'by-server', server_id: serverId }),
    queryFn: ({ signal }) =>
      listManagedDatabases({ page: 1, size: PAGINATION.maxSize, server_id: serverId }, signal),
    enabled: enabled && Number.isFinite(serverId) && serverId > 0,
    staleTime: 10_000,
  })
}

export interface ServerDatabasesResult {
  rows: ServerDatabaseRow[]
  /** El listado físico: sin él no hay tabla que mostrar. */
  physical: ReturnType<typeof usePhysicalDatabases>
  /** El cruce con el inventario: su fallo degrada la tabla, no la bloquea. */
  inventory: ReturnType<typeof useServerInventory>
  /**
   * El inventario tiene más páginas de las que se pidieron ([SUPUESTO S4]): algunas filas
   * podrían mostrarse como «no gestionadas» siendo gestionadas. La UI debe avisarlo en vez de
   * mentir en la insignia.
   */
  inventoryTruncated: boolean
  refetch: () => void
}

export function useServerDatabases(serverId: number, enabled = true): ServerDatabasesResult {
  const physical = usePhysicalDatabases(serverId, enabled)
  const inventory = useServerInventory(serverId, enabled)

  const physicalNames = physical.data
  const inventoryItems = inventory.data?.items

  const rows = useMemo(
    () => crossWithInventory(physicalNames ?? [], inventoryItems),
    [physicalNames, inventoryItems],
  )

  return {
    rows,
    physical,
    inventory,
    inventoryTruncated: inventory.data?.pagination.has_next ?? false,
    refetch: () => {
      void physical.refetch()
      void inventory.refetch()
    },
  }
}
