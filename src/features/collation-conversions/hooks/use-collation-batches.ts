import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type {
  CollationBatchCreate,
  CollationBatchExecuteIn,
  CollationBatchStatus,
  CollationBlueprintVersionIn,
} from '@/lib/contracts'
import {
  cancelCollationBatch,
  createCollationBlueprintVersion,
  executeCollationBatch,
  getCollationBatch,
  getCollationDrift,
  planCollationBatch,
} from '../api/collation-conversions.api'

/**
 * Lote de conversión de collation por blueprint (v17 §3) y deriva (§6).
 *
 * El lote corre **EN SERIE**: `COLLATION_CONVERSION_MAX_WORKERS` es 1 por default, así que un
 * lote de 12 bases monopoliza el módulo por horas. Eso gobierna el diseño del polling de acá —y
 * la UI que lo consume tiene que decirlo, o el monitor parece colgado.
 */

/** Estados terminales del lote: alcanzado uno, ninguna vista debe seguir haciendo polling. */
export const COLLATION_BATCH_TERMINAL_STATUSES = new Set<CollationBatchStatus>([
  'done',
  'failed',
  'canceled',
])

/**
 * Latido del polling del lote.
 *
 * Refresca cada **5 s** y no cada 2 s como el job unitario: el endpoint está limitado a 30/min
 * (2 s daría 30/min exactos, sin margen para que el usuario recargue o abra otra pestaña), y un
 * lote que dura horas no gana nada refrescando más seguido. Se detiene solo en estado terminal.
 */
export function useCollationBatch(modelId: number, batchId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.collationConversions.batch(modelId, batchId),
    queryFn: ({ signal }) => getCollationBatch(modelId, batchId, signal),
    enabled: enabled && Number.isFinite(modelId) && modelId > 0 && batchId > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.batch.status
      return status && !COLLATION_BATCH_TERMINAL_STATUSES.has(status) ? 5000 : false
    },
  })
}

/**
 * Deriva declarada vs. inventario del gateway.
 *
 * **No hace polling ni tiene rate limit**: no abre ninguna conexión al motor, es una lectura de
 * la caché del gateway. Se refresca invalidando la clave (por ejemplo al terminar un lote).
 */
export function useCollationDrift(modelId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.collationConversions.drift(modelId),
    queryFn: ({ signal }) => getCollationDrift(modelId, signal),
    enabled: enabled && Number.isFinite(modelId) && modelId > 0,
  })
}

/**
 * Planificar el lote 🔌 — crea y previsualiza un job por BD activa.
 *
 * No invalida nada: crea un lote nuevo, no modifica uno existente. El llamador se queda con el
 * `batch_id` y el `batch_token` de la respuesta.
 */
export function usePlanCollationBatch(modelId: number) {
  return useMutation({
    mutationFn: (body: CollationBatchCreate) => planCollationBatch(modelId, body),
  })
}

/**
 * Ejecutar el lote 🔌 — confirma y encola.
 *
 * Invalida la clave del lote para que el monitor arranque leyendo el estado real del servidor en
 * lugar de inferirlo de la respuesta de `execute`: son formas distintas (`results[]` acá,
 * `{batch, jobs}` en el polling) y mezclarlas es cómo se cuelan estados fantasma.
 */
export function useExecuteCollationBatch(modelId: number, batchId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CollationBatchExecuteIn) => executeCollationBatch(modelId, batchId, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.collationConversions.batch(modelId, batchId),
      })
    },
  })
}

/**
 * Cancelación cooperativa del lote.
 *
 * Devuelve la misma forma que el polling, así que la respuesta se escribe directo en la caché:
 * evita un tick de 5 s mostrando todavía "en curso" algo que el operador acaba de cancelar.
 */
export function useCancelCollationBatch(modelId: number, batchId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => cancelCollationBatch(modelId, batchId),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.collationConversions.batch(modelId, batchId), data)
    },
  })
}

/**
 * Crear la versión de contabilidad del lote.
 *
 * Invalida el lote (gana `blueprint_version_id`) y la deriva (las BDs quedaron convertidas, así
 * que su estado de deriva cambió).
 */
export function useCreateCollationBlueprintVersion(modelId: number, batchId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CollationBlueprintVersionIn) =>
      createCollationBlueprintVersion(modelId, batchId, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.collationConversions.batch(modelId, batchId),
      })
      void qc.invalidateQueries({ queryKey: queryKeys.collationConversions.drift(modelId) })
    },
  })
}
