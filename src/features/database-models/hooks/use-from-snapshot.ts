import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { FromSnapshotIn } from '@/lib/contracts'
import { createModelFromSnapshot } from '../api/database-models.api'

/**
 * Crea un blueprint baseline desde el snapshot de una BD (Plan 09 §6). El baseline `0001` nace
 * `reviewed=false`: hay que aprobarlo antes de poder aplicarlo.
 */
export function useCreateModelFromSnapshot() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: FromSnapshotIn) => createModelFromSnapshot(body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.all })
      toast.success(
        'Blueprint creado desde snapshot',
        `${result.model.name} · ${result.statements_captured} sentencia(s) capturada(s)`,
      )
    },
    onError: (error) =>
      toast.error('No se pudo crear el blueprint desde snapshot', toApiError(error).message),
  })
}
