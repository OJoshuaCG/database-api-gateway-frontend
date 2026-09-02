import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { listIdentityGrants } from '../api/servers.api'

/**
 * Permisos de una identidad del motor 🔌 (v21 §1), **sin exigir que esté adoptada**.
 *
 * Es la mitad de solo lectura del módulo: consultar funciona por identidad, otorgar no (v21 §12).
 * Por eso esta query se puede disparar en una ficha `unmanaged`, mientras que todo lo que muta
 * sigue colgando de `server_user_id`.
 *
 * En PostgreSQL el backend exige `database` (los grants de objeto viven dentro de una BD): con
 * `requiresDatabase` la query no se dispara hasta que haya una elegida, en vez de provocar un 422
 * que el usuario leería como un fallo suyo.
 */
export function useIdentityGrants(
  serverId: number,
  username: string,
  host: string | undefined,
  database: string | undefined,
  enabled: boolean,
  requiresDatabase = false,
) {
  return useQuery({
    queryKey: queryKeys.servers.identityGrants(serverId, username, host ?? null, database ?? null),
    queryFn: ({ signal }) => listIdentityGrants(serverId, { username, host, database }, signal),
    enabled: enabled && (!requiresDatabase || Boolean(database)),
  })
}
