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
 */
export function invalidateDatabaseViews(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.managedDatabases.all })
  void queryClient.invalidateQueries({
    predicate: (query) =>
      (query.queryKey[0] === 'database-models' || query.queryKey[0] === 'server-users') &&
      query.queryKey[2] === 'databases',
  })
}
