import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifyMutationError } from '@/features/auth'
import { queryKeys } from '@/lib/api/query-keys'
import type { EnvironmentUpdate } from '@/lib/contracts'
import { useToast } from '@/lib/toast/use-toast'
import { updateEnvironment } from '../api/environments.api'

/**
 * Cambia la puerta de agentes de un entorno. Invalida `environments.all` porque el catálogo se
 * cachea con `staleTime: Infinity` (ver `useEnvironmentOptions`): sin invalidar, el panel
 * seguiría mostrando la puerta en su estado anterior hasta recargar la pestaña.
 *
 * Todo error pasa por `notifyMutationError`. Además, el panel lee `error.environmentConfirmation`
 * (422 `environment.confirmation_required`) para mostrar el slug esperado y qué se debilita.
 */
export function useUpdateEnvironment() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({
      id,
      body,
      confirmSlug,
    }: {
      id: number
      body: EnvironmentUpdate
      confirmSlug?: string
    }) => updateEnvironment(id, body, confirmSlug),
    onSuccess: (env) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.environments.all })
      toast.success(
        env.allows_agent_access ? 'Entorno abierto a agentes' : 'Entorno cerrado a agentes',
        env.name,
      )
    },
    onError: (error) => notifyMutationError(toast, error, 'No se pudo actualizar el entorno'),
  })
}
