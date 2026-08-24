import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { compareEnvironments, PAGINATION, type EnvironmentOut } from '@/lib/contracts'
import { listEnvironments } from '../api/environments.api'

/**
 * Catálogo de entornos (4 filas fijas), compartido por 5 consumidores.
 *
 * **Key CONSTANTE y sin parámetros.** Es el punto de deduplicación: react-query deduplica por
 * key, así que 5 consumidores = 1 request siempre que la key sea una sola literal. Un hook
 * parametrizado (`useEnvironmentOptions(algo)`) produciría una entrada por argumento y dos
 * requests. Si algún día hace falta filtrar, se filtra sobre `data`, no en la key.
 *
 * **`staleTime` e `gcTime` en `Infinity`.** Con el `gcTime` por defecto (5 min), si los 5
 * consumidores se desmontan —se cierra el diálogo, se navega de sección— la entrada se recolecta
 * y el siguiente montaje vuelve a `isPending`: reaparece el flash de ids crudos en la tabla,
 * que es justo lo que el join no debe mostrar. El precio es explícito y aceptado: la
 * administración de entornos es **por API** (la SPA no tiene CRUD), así que un cambio hecho por
 * ahí no se ve hasta recargar la pestaña.
 *
 * **NO filtra por `only_active`.** Son dos necesidades con una sola fuente: el SELECTOR debe
 * ofrecer solo los activos, pero el BADGE tiene que resolver el nombre de una base asignada a un
 * entorno que después se desactivó. Filtrando en el servidor esas filas caen en "id sin match" y
 * se pintarían como desconocidas. Se trae completo y el subconjunto activo se deriva acá.
 */
export function useEnvironmentOptions() {
  return useQuery({
    queryKey: queryKeys.environments.list({ options: 'all' }),
    queryFn: ({ signal }) => listEnvironments({ page: 1, size: PAGINATION.maxSize }, signal),
    staleTime: Infinity,
    gcTime: Infinity,
    select: (page): EnvironmentOut[] => [...page.items].sort(compareEnvironments),
  })
}

/** Solo los asignables. Lo que alimenta los `items` de un selector, nunca el join. */
export function useSelectableEnvironments() {
  const query = useEnvironmentOptions()
  const selectable = useMemo(
    () => (query.data ?? []).filter((env) => env.is_active),
    [query.data],
  )
  return { ...query, selectable }
}

/**
 * Mapa `id → entorno` para el join en cliente, más los dos estados que la celda necesita
 * distinguir.
 *
 * Existe aparte de `useEnvironmentOptions` porque son dos usos distintos del mismo dato: de los
 * 5 consumidores, solo 3 hacen join (el inventario, la tabla de estado del blueprint y las BDs
 * del propietario); los otros dos solo necesitan la lista para un selector. Y sin este `useMemo`
 * compartido, cada uno de los 3 rearmaría el mapa por su cuenta.
 *
 * `isPending` e `isError` se exponen porque la celda **no puede colapsarlos** en el mismo texto:
 * una etiqueta de seguridad que falla en abierto no es lo mismo que un nombre que cae a `#id`.
 */
export function useEnvironmentMap() {
  const query = useEnvironmentOptions()
  const byId = useMemo(
    () => new Map((query.data ?? []).map((env) => [env.id, env])),
    [query.data],
  )
  return { byId, isPending: query.isPending, isError: query.isError }
}
