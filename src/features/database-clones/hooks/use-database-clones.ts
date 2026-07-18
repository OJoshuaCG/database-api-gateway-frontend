import { useDeferredValue, useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { QueryParams } from '@/lib/api/client'
import type { CloneObjectRef, CloneStatus } from '@/lib/contracts'
import {
  getCloneObjects,
  getDatabaseClone,
  listCloneItems,
  previewDatabaseClone,
  resolveCloneSelection,
} from '../api/database-clones.api'

/** Estados terminales del job: ninguna vista debe seguir haciendo polling una vez alcanzados. */
export const CLONE_TERMINAL_STATUSES = new Set<CloneStatus>([
  'succeeded',
  'failed',
  'interrupted',
  'canceled',
])

/**
 * Resumen + estado del job (§ Endpoint 2 — el latido del polling). Mientras el job esté
 * `pending`/`running` refresca cada 2s; se detiene sola en cualquier estado terminal. No hay
 * websockets: este es el único mecanismo de seguimiento de la ejecución en segundo plano.
 */
export function useDatabaseClone(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseClones.detail(id),
    queryFn: ({ signal }) => getDatabaseClone(id, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && !CLONE_TERMINAL_STATUSES.has(status) ? 2000 : false
    },
  })
}

/** Inventario del origen (Vista 3): objetos con portabilidad + grafo de dependencias. */
export function useCloneObjects(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseClones.objects(id),
    queryFn: ({ signal }) => getCloneObjects(id, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
  })
}

function refKey(ref: CloneObjectRef): string {
  return `${ref.object_type}:${ref.name}`
}

function sortedKeys(refs: CloneObjectRef[]): string[] {
  return refs.map(refKey).sort()
}

/**
 * Cierre de dependencias de la selección en curso (Vista 3): se difiere con `useDeferredValue`
 * para no disparar una llamada por cada checkbox marcado — mismo patrón que `useExecutePreview`
 * de schema-comparisons (10/min, cacheable por conjunto de selección).
 *
 * `isStale` es `true` mientras `selection` (el valor EN VIVO, recién tocado por el usuario)
 * todavía no alcanzó a `deferredSelection` (el valor con el que se calculó `data`/se disparó la
 * query). Sin este flag, el consumidor podría leer `data`/`isFetching` como "ya resuelto para lo
 * que el usuario tiene marcado ahora mismo" durante la ventana de la transición diferida, cuando
 * en realidad todavía describen la selección ANTERIOR — el caller debe bloquear cualquier acción
 * que dependa del cierre (p. ej. confirmar la selección) mientras `isStale` sea `true`.
 */
export function useCloneResolveSelection(id: number, selection: CloneObjectRef[], enabled: boolean) {
  const deferredSelection = useDeferredValue(selection)
  const keys = useMemo(() => sortedKeys(deferredSelection), [deferredSelection])
  const isStale = selection !== deferredSelection

  const query = useQuery({
    queryKey: queryKeys.databaseClones.resolveSelection(id, keys),
    queryFn: ({ signal }) => resolveCloneSelection(id, { selection: deferredSelection }, signal),
    enabled: enabled && deferredSelection.length > 0 && Number.isFinite(id) && id > 0,
  })

  return { ...query, isStale }
}

/**
 * Preview autoritativo del plan (Vista 4): `selection: null` = clon completo. El `confirm_token`
 * que devuelve es el único válido para `execute`; se difiere igual que el cierre para no
 * recomputar en cada cambio de selección.
 */
export function useClonePreview(id: number, selection: CloneObjectRef[] | null, enabled: boolean) {
  const deferredSelection = useDeferredValue(selection)
  const keys = useMemo(
    () => (deferredSelection ? sortedKeys(deferredSelection) : null),
    [deferredSelection],
  )

  return useQuery({
    queryKey: queryKeys.databaseClones.preview(id, keys),
    queryFn: ({ signal }) => previewDatabaseClone(id, { selection: deferredSelection }, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
  })
}

/**
 * Pasos ejecutados, paginados (Vista 6): se llena incrementalmente durante el polling.
 * `poll` debe reflejar si el job aún no llegó a un estado terminal — si no, esta tabla se
 * queda congelada en la última página cargada mientras el job sigue avanzando en el motor.
 */
export function useCloneItems(id: number, params: QueryParams, enabled: boolean, poll: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseClones.items(id, params),
    queryFn: ({ signal }) => listCloneItems(id, params, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
    placeholderData: keepPreviousData,
    refetchInterval: poll ? 2000 : false,
  })
}
