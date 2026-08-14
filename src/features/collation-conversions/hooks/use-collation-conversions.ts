import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { QueryParams } from '@/lib/api/client'
import type { CollationConversionPreviewIn, CollationJobStatus } from '@/lib/contracts'
import {
  getCollationConversion,
  getCollationConversionObjects,
  listCollationConversionItems,
  previewCollationConversion,
} from '../api/collation-conversions.api'

/** Estados terminales del job: ninguna vista debe seguir haciendo polling una vez alcanzados. */
export const COLLATION_CONVERSION_TERMINAL_STATUSES = new Set<CollationJobStatus>([
  'succeeded',
  'failed',
  'interrupted',
  'canceled',
])

/**
 * Resumen + estado del job (el latido del polling). Mientras el job esté `pending`/`running`
 * refresca cada 2s; se detiene sola en cualquier estado terminal. No hay websockets: este es el
 * único mecanismo de seguimiento de la ejecución en segundo plano.
 */
export function useCollationConversion(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.collationConversions.detail(id),
    queryFn: ({ signal }) => getCollationConversion(id, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && !COLLATION_CONVERSION_TERMINAL_STATUSES.has(status) ? 2000 : false
    },
  })
}

/**
 * Inventario bajo demanda: tablas/objetos con su charset/collation actual + collations
 * disponibles. Este endpoint siempre devuelve la realidad actual del motor, así que NO hace
 * polling propio — se refresca con un botón "recargar inventario" que invalida la query.
 */
export function useCollationConversionObjects(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.collationConversions.objects(id),
    queryFn: ({ signal }) => getCollationConversionObjects(id, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
  })
}

/**
 * Preview autoritativo del plan: el `confirm_token` que devuelve es el único válido para
 * `execute`. El wizard es quien difiere `body` con `useDeferredValue` antes de llamar a este
 * hook (mismo criterio que `useClonePreview`); acá solo se dispara la query con lo que llegue.
 */
export function useCollationConversionPreview(
  id: number,
  body: CollationConversionPreviewIn,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.collationConversions.preview(id, body),
    queryFn: ({ signal }) => previewCollationConversion(id, body, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
  })
}

/**
 * Pasos ejecutados, paginados: se llena incrementalmente durante el polling. `poll` debe
 * reflejar si el job aún no llegó a un estado terminal — si no, esta tabla se queda congelada en
 * la última página cargada mientras el job sigue avanzando en el motor.
 */
export function useCollationConversionItems(
  id: number,
  params: QueryParams,
  enabled: boolean,
  poll: boolean,
) {
  return useQuery({
    queryKey: queryKeys.collationConversions.items(id, params),
    queryFn: ({ signal }) => listCollationConversionItems(id, params, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
    placeholderData: keepPreviousData,
    refetchInterval: poll ? 2000 : false,
  })
}
