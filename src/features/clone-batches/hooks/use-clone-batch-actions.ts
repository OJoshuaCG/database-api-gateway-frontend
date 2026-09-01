import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { useToast } from '@/lib/toast/use-toast'
import type { CloneBatchCreateIn, CloneBatchExecuteIn, CloneBatchOut } from '@/lib/contracts'
import {
  cancelCloneBatch,
  createCloneBatch,
  executeCloneBatch,
  retryCloneBatch,
} from '../api/clone-batches.api'

export function useCreateCloneBatch() {
  const toast = useToast()
  return useMutation<CloneBatchOut, unknown, CloneBatchCreateIn>({
    mutationFn: (body) => createCloneBatch(body),
    onSuccess: (batch) => {
      toast.success('Plan del lote creado', `${batch.total} bases listas para confirmar.`)
    },
  })
}

export function useExecuteCloneBatch(batchId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<CloneBatchOut, unknown, CloneBatchExecuteIn>({
    mutationFn: (body) => executeCloneBatch(batchId, body),
    onSuccess: (batch) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloneBatches.detail(batchId) })
      toast.success('Lote encolado', `Se clonarán ${batch.total} bases, de a una por vez.`)
    },
  })
}

export function useCancelCloneBatch(batchId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<CloneBatchOut, unknown, void>({
    mutationFn: () => cancelCloneBatch(batchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloneBatches.detail(batchId) })
      toast.success(
        'Cancelación solicitada',
        'La base en curso también se detiene; las que faltan no arrancan.',
      )
    },
  })
}

/**
 * Relanza las filas que quedaron con el destino intacto. Devuelve un lote NUEVO en estado
 * `pending`: hay que volver a confirmarlo, y eso es deliberado — el estado de los servidores
 * cambió desde el plan original.
 */
export function useRetryCloneBatch(batchId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<CloneBatchOut, unknown, void>({
    mutationFn: () => retryCloneBatch(batchId),
    onSuccess: (batch) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloneBatches.all })
      toast.success(
        'Lote de reintento creado',
        `${batch.total} bases. Revisalo y confirmalo para que arranque.`,
      )
    },
  })
}
