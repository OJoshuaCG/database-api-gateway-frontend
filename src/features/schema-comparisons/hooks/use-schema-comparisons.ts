import { useDeferredValue, useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { QueryParams } from '@/lib/api/client'
import type { ExecuteMode } from '@/lib/contracts'
import {
  fetchAllSchemaComparisonItems,
  getSchemaComparison,
  listSchemaComparisonItems,
  previewExecuteComparison,
  resolveComparisonSelection,
} from '../api/schema-comparisons.api'

/** Resumen de una comparación (§ Endpoint 2) — no vuelve a tocar el motor, solo lee el inventario. */
export function useSchemaComparison(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.schemaComparisons.detail(id),
    queryFn: ({ signal }) => getSchemaComparison(id, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
  })
}

/** Ítems del diff, paginados server-side (Vista 3, navegación de solo lectura). */
export function useSchemaComparisonItems(id: number, params: QueryParams, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.schemaComparisons.items(id, params),
    queryFn: ({ signal }) => listSchemaComparisonItems(id, params, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
    placeholderData: keepPreviousData,
  })
}

/**
 * Conjunto COMPLETO de ítems filtrados en memoria (Vistas de selección 4a/5a): pagina hasta
 * agotar `has_next` para que los atajos "todo"/"solo aditivos seguros" operen sobre el diff
 * entero, no solo la página visible. Ver `fetchAllSchemaComparisonItems` para el tope de páginas.
 */
export function useAllSchemaComparisonItems(id: number, filters: QueryParams, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.schemaComparisons.itemsAll(id, filters),
    queryFn: ({ signal }) => fetchAllSchemaComparisonItems(id, filters, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
  })
}

/**
 * Vista previa AUTORITATIVA de ejecución (Opción B): se modela como `useQuery`, no como mutación
 * por cada cambio, porque `execute-preview` es de solo lectura, sin rate limit y cacheable por
 * `(mode, selected_item_ids)`. `selectedItemIds` se ordena antes de entrar a la query key (evita
 * refetch espurio si el usuario marca los mismos ítems en otro orden) y se difiere con
 * `useDeferredValue` para no disparar una llamada por cada clic de checkbox en modo `custom`.
 */
export function useExecutePreview(
  id: number,
  mode: ExecuteMode,
  selectedItemIds: number[],
  enabled: boolean,
) {
  const sortedIds = useMemo(() => [...selectedItemIds].sort((a, b) => a - b), [selectedItemIds])
  const deferredIds = useDeferredValue(sortedIds)
  const deferredMode = useDeferredValue(mode)
  // El backend exige selected_item_ids en modo custom; nunca disparamos una llamada que sabemos
  // que devolverá 422 por falta de selección.
  const resolvable = deferredMode !== 'custom' || deferredIds.length > 0

  return useQuery({
    queryKey: queryKeys.schemaComparisons.preview(id, deferredMode, deferredIds),
    queryFn: ({ signal }) =>
      previewExecuteComparison(
        id,
        {
          mode: deferredMode,
          selected_item_ids: deferredMode === 'custom' ? deferredIds : null,
        },
        signal,
      ),
    enabled: enabled && resolvable && Number.isFinite(id) && id > 0,
  })
}

/**
 * Cierre de dependencias de la selección (§10.6): solo lectura, se modela como `useQuery`
 * cacheable por conjunto de ids (mismo patrón que `useExecutePreview` aquí y que
 * `useCloneResolveSelection` en database-clones). Los ids se ordenan antes de entrar a la query
 * key (el cierre de un conjunto no depende del orden de marcado) y se difieren con
 * `useDeferredValue` por si la selección cambia en ráfaga (p. ej. al aplicar los
 * `suggested_item_ids` de un 422).
 *
 * `isStale` es `true` mientras la selección EN VIVO aún no alcanzó a la diferida con la que se
 * calculó `data`: el caller debe bloquear el submit mientras tanto (si no, podría confirmar con
 * un cierre que describe la selección ANTERIOR).
 */
export function useResolveComparisonSelection(
  id: number,
  selectedItemIds: number[],
  enabled: boolean,
) {
  const sortedIds = useMemo(() => [...selectedItemIds].sort((a, b) => a - b), [selectedItemIds])
  const deferredIds = useDeferredValue(sortedIds)
  const isStale = sortedIds !== deferredIds

  const query = useQuery({
    queryKey: queryKeys.schemaComparisons.resolveSelection(id, deferredIds),
    queryFn: ({ signal }) =>
      resolveComparisonSelection(id, { selected_item_ids: deferredIds }, signal),
    enabled: enabled && deferredIds.length > 0 && Number.isFinite(id) && id > 0,
  })

  return { ...query, isStale }
}
