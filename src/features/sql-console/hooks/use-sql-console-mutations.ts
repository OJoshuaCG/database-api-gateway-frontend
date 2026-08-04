import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { QueryExecuteIn, QueryPreviewIn } from '@/lib/contracts'
import { executeQuery, previewQuery } from '../api/sql-console.api'

/**
 * Preview y execute son MUTACIONES, no queries, aunque el preview "solo clasifique":
 * puede abrir conexión al motor para estimar impacto, emite un token de un solo uso con TTL
 * de 2 minutos y está limitado a 30 llamadas por minuto. Cachearlo o refetchearlo al volver
 * a la ventana sería, en el mejor caso, gastar el rate limit; en el peor, correr los
 * `SELECT COUNT(*)` de estimación contra una tabla enorme sin que nadie los pidiera.
 */

/** Clasifica el lote y emite el `confirm_token`. No ejecuta el SQL del usuario. */
export function usePreviewQuery(serverId: number) {
  return useMutation({
    mutationFn: (body: QueryPreviewIn) => previewQuery(serverId, body),
    // Un 429 reintentado automáticamente solo agrava el rate limit.
    retry: false,
  })
}

/**
 * Ejecuta el lote.
 *
 * Sin `onError`: el rechazo del motor ni siquiera pasa por ahí (llega como 200 con
 * `success: false`), y los errores reales necesitan una salida distinta según el caso, que
 * decide la pantalla con `classifyQueryError`. Un toast genérico taparía esa diferencia.
 */
export function useExecuteQuery(serverId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: QueryExecuteIn) => executeQuery(serverId, body),
    retry: false,
    onSuccess: () => {
      // El historial se escribe siempre que se llegó al motor, con éxito o sin él.
      void queryClient.invalidateQueries({ queryKey: queryKeys.sqlConsole.all })
    },
  })
}
