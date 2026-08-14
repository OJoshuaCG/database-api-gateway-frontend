import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { useToast } from '@/lib/toast/use-toast'
import type {
  CollationConversionCreate,
  CollationConversionExecuteIn,
  CollationConversionSummaryOut,
} from '@/lib/contracts'
import {
  cancelCollationConversion,
  createCollationConversion,
  executeCollationConversion,
} from '../api/collation-conversions.api'

/**
 * Mutaciones "propiedad del asistente" (mismo patrón que `database-clones`): el error NO se
 * notifica por toast global — cada paso renderiza el `ApiError` inline con su CTA de recuperación
 * (422 collation rechazada, 409 anti-TOCTOU, 410 replanear). Solo el éxito emite un toast.
 */
export function useCreateCollationConversion() {
  const toast = useToast()
  return useMutation<
    CollationConversionSummaryOut,
    unknown,
    { serverId: number; database: string; body: CollationConversionCreate }
  >({
    mutationFn: ({ serverId, database, body }) =>
      createCollationConversion(serverId, database, body),
    onSuccess: (summary) => {
      toast.success(
        'Plan de conversión creado',
        `${summary.database_name} → ${summary.target_collation}`,
      )
    },
  })
}

export function useExecuteCollationConversion() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<
    CollationConversionSummaryOut,
    unknown,
    { id: number; body: CollationConversionExecuteIn }
  >({
    mutationFn: ({ id, body }) => executeCollationConversion(id, body),
    onSuccess: (summary) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.collationConversions.detail(summary.id),
      })
      toast.success('Conversión encolada', `Job #${summary.id} · sigue el avance en el monitor.`)
    },
  })
}

export function useCancelCollationConversion() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<CollationConversionSummaryOut, unknown, number>({
    mutationFn: (id) => cancelCollationConversion(id),
    onSuccess: (summary) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.collationConversions.detail(summary.id),
      })
      toast.success('Cancelación solicitada', 'El worker cortará en el próximo punto seguro.')
    },
  })
}
