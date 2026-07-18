import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { CloneCreateIn, CloneExecuteIn, CloneSummaryOut } from '@/lib/contracts'
import { cancelDatabaseClone, createDatabaseClone, executeDatabaseClone } from '../api/database-clones.api'

/**
 * Mutaciones "propiedad del asistente" (mismo patrón que schema-comparisons): el error NO se
 * notifica por toast global — cada paso renderiza el `ApiError` inline con su CTA de recuperación
 * (410 replanear, 409 anti-TOCTOU/cuarentena, 422 nombre/token). Solo el éxito emite un toast.
 */
export function useCreateDatabaseClone() {
  const toast = useToast()
  return useMutation<CloneSummaryOut, unknown, CloneCreateIn>({
    mutationFn: (body) => createDatabaseClone(body),
    onSuccess: (summary) => {
      toast.success(
        'Plan de clonación creado',
        `${summary.source_database_name} (${summary.source_engine}) → ${summary.target_database_name} (${summary.target_engine})`,
      )
    },
  })
}

export function useExecuteDatabaseClone(jobId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<CloneSummaryOut, unknown, CloneExecuteIn>({
    mutationFn: (body) => executeDatabaseClone(jobId, body),
    onSuccess: (summary) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseClones.detail(jobId) })
      toast.success('Clonación encolada', `Job #${summary.id} · sigue el avance en el monitor.`)
    },
  })
}

export function useCancelDatabaseClone(jobId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<CloneSummaryOut, unknown, void>({
    mutationFn: () => cancelDatabaseClone(jobId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseClones.detail(jobId) })
      toast.success('Cancelación solicitada', 'El worker cortará en el próximo punto seguro.')
    },
    onError: (error) => toast.error('No se pudo cancelar', toApiError(error).message),
  })
}
