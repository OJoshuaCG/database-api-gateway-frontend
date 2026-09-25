import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'

/**
 * Invalida **todas** las vistas que muestran una BD gestionada, no solo el inventario.
 *
 * Existe porque el backend comparte un solo schema entre tres endpoints
 * (`GET /managed-databases`, `GET /database-models/{id}/databases`,
 * `GET /server-users/{id}/databases`) pero acá viven en **tres troncos de key distintos**
 * (`['managed-databases']`, `['database-models', id, 'databases']`,
 * `['server-users', id, 'databases']`). No hay prefijo común, así que un
 * `invalidateQueries({ queryKey: managedDatabases.all })` —lo que hacían las cuatro mutaciones—
 * dejaba rancias las otras dos.
 *
 * Antes se notaba poco porque esas vistas solo mostraban nombre, versión y estado. Ahora muestran
 * el ENTORNO: reclasificar una base desde el inventario dejaba el badge viejo justo en las dos
 * pantallas donde importa. Y no hay red de seguridad que lo tape — el QueryClient de la app usa
 * `staleTime: 30_000` y `refetchOnWindowFocus: false`.
 *
 * Se centraliza en un helper y no se repite en los 5 sitios porque el `predicate` es fácil de
 * escribir distinto en cada uno, y una divergencia acá no falla: solo muestra datos viejos.
 *
 * **`serverId` es obligatorio a propósito.** La ficha de una base (`ServerDatabaseDetailPage`)
 * deduce si existe del listado FÍSICO del servidor (`servers.databases`), no del inventario, y la
 * reconciliación (`servers.reconcile`) cruza los dos planos. Con solo el inventario al día, la
 * ficha afirmaba estados falsos justo tras sus propias acciones: tras «Aprovisionar» el registro
 * volvía `active`, el listado viejo no la tenía, y la ficha decía «ya no aparece en el motor» y
 * ofrecía «Recrear 🔌» sobre una base recién creada; tras quitarla del inventario con el DROP, la
 * fila física vieja la mostraba «no gestionada» y ofrecía adoptar una base ya borrada. Como
 * parámetro obligatorio no se puede olvidar: quien no toca un servidor concreto (las migraciones
 * de un blueprint, que abarcan varios) lo dice pasando `null`.
 *
 * Del listado físico se invalida solo la lista (`exact`), no su prefijo: debajo cuelgan tablas,
 * snapshot y grantees, que un cambio de inventario no altera y cuyo refetch abre conexiones 🔌.
 */
export function invalidateDatabaseViews(queryClient: QueryClient, serverId: number | null): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
  void queryClient.invalidateQueries({
    predicate: (query) =>
      (query.queryKey[0] === 'database-models' || query.queryKey[0] === 'server-users') &&
      query.queryKey[2] === 'databases',
  })
  if (serverId === null) return
  void queryClient.invalidateQueries({
    queryKey: queryKeys.servers.databases(serverId),
    exact: true,
  })
  void queryClient.invalidateQueries({ queryKey: queryKeys.servers.reconcile(serverId) })
}
