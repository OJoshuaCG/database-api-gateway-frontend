import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { useToast } from '@/lib/toast/use-toast'
import type { FromSnapshotIn, FromSnapshotOut } from '@/lib/contracts'
import { createModelFromSnapshot } from '../api/database-models.api'

/**
 * Crea un blueprint desde el snapshot de una BD (Plan 09 §6). Todas las versiones nacen
 * `reviewed=false`: hay que revisarlas y aprobarlas antes de poder aplicarlas.
 *
 * El error NO se notifica por toast: el asistente lo maneja inline (mapeando 409/422/429/500 al
 * paso implicado y mostrando el `X-Request-ID`). El éxito sí emite un toast de confirmación.
 */
export function useCreateModelFromSnapshot() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<FromSnapshotOut, unknown, FromSnapshotIn>({
    mutationFn: (body) => createModelFromSnapshot(body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.all })
      toast.success(
        result.model.name,
        `Blueprint creado · ${result.total_versions ?? result.versions.length} versión(es) · ${result.statements_captured} sentencia(s)`,
      )
    },
  })
}
