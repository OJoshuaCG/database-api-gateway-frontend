import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { PAGINATION, type ServerUserOut } from '@/lib/contracts'
import { listServerUsers } from '@/features/server-users/api/server-users.api'

/**
 * Propietarios (`owner_id` → usuario del motor) de las bases de una página del inventario.
 *
 * El inventario mezcla servidores y los usuarios son por servidor, así que se pide un listado por
 * cada servidor DISTINTO de la página. Usa la misma key y la misma petición que
 * `useServerUserOptions`: comparten la entrada de caché con los selects de propietario y con el
 * listado de bases de un servidor, así que visitar uno calienta el otro.
 *
 * Degrada solo: si un propietario no está en la página cargada de su servidor (o su listado
 * falla), no aparece en el mapa y la celda muestra su id sin enlace.
 */
export function useOwnerDirectory(serverIds: readonly number[]): Map<number, ServerUserOut> {
  const distinct = useMemo(() => [...new Set(serverIds)].sort((a, b) => a - b), [serverIds])

  return useQueries({
    queries: distinct.map((serverId) => ({
      queryKey: queryKeys.serverUsers.list({ options: 'all', server_id: serverId }),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listServerUsers({ page: 1, size: PAGINATION.maxSize, server_id: serverId }, signal),
      staleTime: 60_000,
    })),
    combine: toOwnerMap,
  })
}

/**
 * Fuera del componente a propósito: con un `combine` estable, TanStack Query solo lo vuelve a
 * ejecutar cuando cambia algún `data`, así que el mapa conserva su identidad entre renders y no
 * invalida el `useMemo` de las columnas de la tabla.
 */
function toOwnerMap(
  results: readonly { data?: { items: readonly ServerUserOut[] } }[],
): Map<number, ServerUserOut> {
  const map = new Map<number, ServerUserOut>()
  for (const result of results) {
    for (const user of result.data?.items ?? []) map.set(user.id, user)
  }
  return map
}
