import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { getTableSchema, listServerDatabases, listTables } from '../api/servers.api'

/**
 * Introspección 🔌 como cadena de queries dependientes:
 * servidor → bases de datos → tablas → esquema. Cada nivel se habilita al elegir el anterior.
 */
export function useServerDatabases(serverId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.servers.databases(serverId),
    queryFn: ({ signal }) => listServerDatabases(serverId, signal),
    enabled,
  })
}

export function useTables(serverId: number, database: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.servers.tables(serverId, database ?? ''),
    queryFn: ({ signal }) => listTables(serverId, database!, signal),
    enabled: enabled && Boolean(database),
  })
}

export function useTableSchema(
  serverId: number,
  database: string | null,
  table: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.servers.tableSchema(serverId, database ?? '', table ?? ''),
    queryFn: ({ signal }) => getTableSchema(serverId, database!, table!, signal),
    enabled: enabled && Boolean(database) && Boolean(table),
  })
}
