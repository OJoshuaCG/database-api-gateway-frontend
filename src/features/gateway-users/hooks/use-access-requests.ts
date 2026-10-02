import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import { notifyMutationError, useSession } from '@/features/auth'
import type { AccessRequest, AccessRequestDecision } from '@/lib/contracts'
import {
  approveAccessRequest,
  cancelAccessRequest,
  getAccessRequest,
  listPendingAccessRequests,
  rejectAccessRequest,
} from '../api/access-requests.api'
import { accessRequestErrorMessage } from '../messages'

/**
 * Qué refrescar tras decidir una elevación. Aprobar escribe el acceso de la persona (listado,
 * detalle, acceso efectivo, separación de deberes), y cualquier decisión saca la fila de la
 * bandeja. `/auth/me` solo si la persona afectada es la de la sesión (con la sesión sin cargar se
 * refresca igual: un refetch de más es barato, un guard desactualizado no).
 */
export function useRefreshAfterAccessChange() {
  const queryClient = useQueryClient()
  const { admin } = useSession()
  const sessionUserId = admin?.id ?? null
  return (targetId: number) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.accessRequests.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.capabilityGrants.effective(targetId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.authz.sodReport() })
    if (sessionUserId === null || sessionUserId === targetId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() })
    }
  }
}

/** Bandeja de elevaciones pendientes (todas las personas). Solo con `access.admin`. */
export function usePendingAccessRequests(enabled = true) {
  return useQuery({
    queryKey: queryKeys.accessRequests.pending(),
    queryFn: ({ signal }) => listPendingAccessRequests(signal),
    enabled,
  })
}

/** Una solicitud en cualquier estado: la que se destaca al llegar desde el aviso de un `202`. */
export function useAccessRequest(id: number | null) {
  return useQuery({
    queryKey: queryKeys.accessRequests.detail(id ?? 0),
    queryFn: ({ signal }) => getAccessRequest(id ?? 0, signal),
    enabled: id !== null,
  })
}

type Decide = (id: number, body: AccessRequestDecision) => Promise<AccessRequest>

/**
 * Aprobar, rechazar o cancelar. Un 404/409 (otra persona la decidió, venció, quedó vieja o el
 * solicitante perdió la función) refresca la bandeja para que la fila desaparezca en vez de seguir
 * ofreciendo botones; el diálogo muestra el motivo.
 */
function useDecideAccessRequest(decide: Decide, copy: { success: string; failure: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const refresh = useRefreshAfterAccessChange()
  return useMutation({
    mutationFn: ({ requestId, reason }: { requestId: number; reason?: string }) =>
      // Sin motivo se manda `{}`: el campo es opcional y una cadena vacía no es un motivo.
      decide(requestId, reason?.trim() ? { reason: reason.trim() } : {}),
    onSuccess: (request) => {
      refresh(request.target.id)
      toast.success(copy.success, request.target.username)
    },
    onError: (error) => {
      const status = toApiError(error).status
      if (status === 404 || status === 409) {
        // `request_stale` además cancela la solicitud y deja el acceso como está: se refresca todo.
        void queryClient.invalidateQueries({ queryKey: queryKeys.accessRequests.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
      }
      const apiError = toApiError(error)
      notifyMutationError(
        toast,
        error,
        copy.failure,
        accessRequestErrorMessage(apiError) ?? apiError.message,
      )
    },
  })
}

export function useApproveAccessRequest() {
  return useDecideAccessRequest(approveAccessRequest, {
    success: 'Elevación aprobada y aplicada',
    failure: 'No se pudo aprobar la elevación',
  })
}

export function useRejectAccessRequest() {
  return useDecideAccessRequest(rejectAccessRequest, {
    success: 'Elevación rechazada',
    failure: 'No se pudo rechazar la elevación',
  })
}

export function useCancelAccessRequest() {
  return useDecideAccessRequest(cancelAccessRequest, {
    success: 'Solicitud cancelada',
    failure: 'No se pudo cancelar la solicitud',
  })
}
