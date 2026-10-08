import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import { notifyMutationError, useSession } from '@/features/auth'
import type {
  CapabilityGrant,
  CapabilityGrantBulkCreate,
  CapabilityGrantCreate,
  CapabilityGrantDecision,
  CapabilityGrantDecisionBulk,
  CapabilityGrantStatus,
} from '@/lib/contracts'
import {
  approveCapabilityGrant,
  createCapabilityGrant,
  createCapabilityGrantsBulk,
  decideCapabilityGrantsBulk,
  getEffectiveAccess,
  listCapabilityGrants,
  listPendingCapabilityGrants,
  rejectCapabilityGrant,
  revokeCapabilityGrant,
} from '../api/capability-grants.api'
import { capabilityGrantErrorMessage } from '../messages'

/** Título + detalle de un error, con el copy de las capacidades puntuales cuando lo reconoce. */
function errorToast(title: string, error: unknown, decision = false): [string, string] {
  const apiError = toApiError(error)
  return [title, capabilityGrantErrorMessage(apiError, { decision }) ?? apiError.message]
}

/** Etiqueta corta del destino para los toasts: «servidor 3» si el nombre no vino. */
function targetLabel(grant: CapabilityGrant): string {
  return grant.scope_name ?? `${grant.scope_type} ${grant.scope_id}`
}

/**
 * Qué refrescar tras cualquier cambio de capacidades puntuales.
 *
 * Se invalida TODO `capabilityGrants.all` y no cada clave por separado: aprobar, revocar o crear
 * mueve a la vez la lista de la persona, su acceso efectivo y la bandeja de pendientes, y olvidar
 * una de las tres deja a la pantalla contradiciéndose. `/auth/me` solo se refresca si la persona
 * afectada ES la de la sesión: sus `capabilities` y `capability_grants` cambian, y de ahí cuelgan
 * los guards de toda la UI. Con la sesión todavía sin cargar se refresca igual, que es el lado
 * seguro (un refetch de más es barato; un guard desactualizado no).
 */
function useRefreshAfterGrantChange() {
  const queryClient = useQueryClient()
  const { admin } = useSession()
  const sessionUserId = admin?.id ?? null
  return (granteeId: number) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.capabilityGrants.all })
    // Una capacidad exclusiva de `owner` cuenta para la separación de deberes (v29 §8).
    void queryClient.invalidateQueries({ queryKey: queryKeys.authz.sodReport() })
    if (sessionUserId === null || sessionUserId === granteeId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() })
    }
  }
}

/**
 * Tras un 404/409 la copia local está vieja (otra persona ya cerró la capacidad): se refrescan las
 * consultas para que la UI deje de ofrecer una acción que ya no existe.
 */
function useRefreshStale() {
  const queryClient = useQueryClient()
  return (error: unknown) => {
    const status = toApiError(error).status
    if (status === 404 || status === 409) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.capabilityGrants.all })
    }
  }
}

/**
 * Historial de capacidades puntuales de una persona. `enabled` lo apaga quien no tiene
 * `access.admin` (solo de `access_admin`): pedirlo sería un 403 seguro.
 */
export function useCapabilityGrants(
  userId: number,
  options: { status?: CapabilityGrantStatus; enabled?: boolean } = {},
) {
  const { status, enabled = true } = options
  return useQuery({
    queryKey: queryKeys.capabilityGrants.byUser(userId, status),
    queryFn: ({ signal }) => listCapabilityGrants(userId, status, signal),
    enabled,
  })
}

/** Acceso efectivo de otra persona, con procedencia. Solo con `access.admin`. */
export function useEffectiveAccess(userId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.capabilityGrants.effective(userId),
    queryFn: ({ signal }) => getEffectiveAccess(userId, signal),
    enabled,
  })
}

/** Bandeja de solicitudes pendientes (todas las personas). Solo con `access.admin`. */
export function usePendingCapabilityGrants(enabled = true) {
  return useQuery({
    queryKey: queryKeys.capabilityGrants.pending(),
    queryFn: ({ signal }) => listPendingCapabilityGrants(signal),
    enabled,
  })
}

/**
 * Alta. El toast distingue los dos desenlaces porque significan cosas distintas: `active` ya rige,
 * `pending` todavía no concede nada hasta que otra persona la apruebe.
 */
export function useCreateCapabilityGrant(userId: number) {
  const toast = useToast()
  const refresh = useRefreshAfterGrantChange()
  return useMutation({
    mutationFn: (body: CapabilityGrantCreate) => createCapabilityGrant(userId, body),
    onSuccess: (grant) => {
      refresh(userId)
      if (grant.status === 'pending') {
        toast.success(
          'Solicitud enviada',
          `Falta que otra persona con access_admin apruebe «${grant.capability}» en ${targetLabel(grant)}.`,
        )
      } else {
        toast.success('Capacidad otorgada', `${grant.capability} en ${targetLabel(grant)}.`)
      }
    },
    onError: (error) =>
      notifyMutationError(toast, error, ...errorToast('No se pudo otorgar la capacidad', error)),
  })
}

/**
 * Alta masiva: una o varias capacidades sobre varios destinos, todo o nada. Con varias capacidades
 * las filas pueden nacer con estados distintos (una sensible `pending`, una común `active`), así
 * que el toast cuenta las pendientes en vez de asumir un estado único. El 409
 * `access.grant_bulk_failed` no deja nada creado; el detalle por par lo muestra el formulario
 * (`grantBulkFailures`).
 */
export function useCreateCapabilityGrantsBulk(userId: number) {
  const toast = useToast()
  const refresh = useRefreshAfterGrantChange()
  return useMutation({
    mutationFn: (body: CapabilityGrantBulkCreate) => createCapabilityGrantsBulk(userId, body),
    onSuccess: (result) => {
      refresh(userId)
      const capabilities = [...new Set(result.grants.map((grant) => grant.capability))]
      const capabilityText =
        capabilities.length === 1 ? (capabilities[0] ?? '') : `${capabilities.length} capacidades`
      const targetCount = new Set(result.grants.map((grant) => grant.scope_id)).size
      const targets = `${targetCount} destino${targetCount === 1 ? '' : 's'}`
      const pendingCount = result.grants.filter((grant) => grant.status === 'pending').length
      if (pendingCount === 0) {
        toast.success('Capacidades otorgadas', `${capabilityText} en ${targets}.`)
      } else if (pendingCount === result.grants.length) {
        toast.success(
          'Solicitudes enviadas',
          `Falta que otra persona con access_admin apruebe «${capabilityText}» en ${targets}.`,
        )
      } else {
        toast.success(
          'Capacidades otorgadas y solicitudes enviadas',
          `${pendingCount} de ${result.grants.length} quedan pendientes de que otra persona con access_admin las apruebe; el resto ya rige.`,
        )
      }
    },
    onError: (error) =>
      notifyMutationError(
        toast,
        error,
        ...errorToast('No se pudieron otorgar las capacidades', error),
      ),
  })
}

/** Revocación (activa) o cancelación (pendiente). El backend decide cuál según el estado. */
export function useRevokeCapabilityGrant(userId: number) {
  const toast = useToast()
  const refresh = useRefreshAfterGrantChange()
  const refreshStale = useRefreshStale()
  return useMutation({
    mutationFn: (grantId: number) => revokeCapabilityGrant(userId, grantId),
    onSuccess: (grant) => {
      refresh(userId)
      toast.success(
        grant.status === 'cancelled' ? 'Solicitud cancelada' : 'Capacidad revocada',
        `${grant.capability} en ${targetLabel(grant)}.`,
      )
    },
    onError: (error) => {
      refreshStale(error)
      notifyMutationError(toast, error, ...errorToast('No se pudo revocar la capacidad', error))
    },
  })
}

/**
 * Aprobar o rechazar una solicitud pendiente. El `userId` de la persona afectada no se conoce
 * antes de la llamada (la bandeja junta a todas), así que el refresco de `/auth/me` se decide con
 * el `user_id` de la respuesta. Un 404/409 (la decidió otra persona, venció o se canceló) refresca
 * la bandeja para que la fila desaparezca en vez de seguir ofreciendo botones.
 */
function useDecideCapabilityGrant(
  decide: (grantId: number, body: CapabilityGrantDecision) => Promise<CapabilityGrant>,
  copy: { success: string; failure: string },
) {
  const toast = useToast()
  const refresh = useRefreshAfterGrantChange()
  const refreshStale = useRefreshStale()
  return useMutation({
    mutationFn: ({ grantId, reason }: { grantId: number; reason?: string }) =>
      // Sin motivo se manda `{}`: el campo es opcional y una cadena vacía no es un motivo.
      decide(grantId, reason?.trim() ? { reason: reason.trim() } : {}),
    onSuccess: (grant) => {
      refresh(grant.user_id)
      toast.success(copy.success, `${grant.capability} en ${targetLabel(grant)}.`)
    },
    onError: (error) => {
      refreshStale(error)
      notifyMutationError(toast, error, ...errorToast(copy.failure, error, true))
    },
  })
}

export function useApproveCapabilityGrant() {
  return useDecideCapabilityGrant(approveCapabilityGrant, {
    success: 'Capacidad aprobada',
    failure: 'No se pudo aprobar la solicitud',
  })
}

export function useRejectCapabilityGrant() {
  return useDecideCapabilityGrant(rejectCapabilityGrant, {
    success: 'Solicitud rechazada',
    failure: 'No se pudo rechazar la solicitud',
  })
}

/**
 * Aprobar o rechazar VARIAS solicitudes con una sola llamada (`POST /capability-grants/decisions`).
 *
 * Mejor esfuerzo: la respuesta es 200 aunque haya bloqueadas, así que el éxito del `useMutation`
 * NO significa que todo se decidió; el resumen por solicitud (`results[]`) lo pinta quien llama.
 * Por eso el toast distingue tres casos: todas decididas (éxito), algunas (aviso) y ninguna (error).
 *
 * `retry: false`: una decisión no se repite sola. El step-up lo pide la capa de peticiones una vez
 * para todo el lote (ventana de 5 minutos) y reintenta la llamada con la contraseña.
 *
 * Se refresca el árbol completo y `/auth/me` según las personas afectadas: se invalida por cada
 * `user_id` decidido, no solo por la primera.
 */
export function useDecideCapabilityGrantsBulk() {
  const toast = useToast()
  const refresh = useRefreshAfterGrantChange()
  const queryClient = useQueryClient()
  return useMutation({
    retry: false,
    mutationFn: ({
      decision,
      ids,
      reason,
    }: {
      decision: CapabilityGrantDecisionBulk['decision']
      ids: number[]
      reason?: string
    }) =>
      decideCapabilityGrantsBulk({
        decision,
        ids,
        // Sin motivo no se manda el campo: una cadena vacía no es un motivo.
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: (result, variables) => {
      const decidedUserIds = result.results.flatMap((item) => (item.ok ? [item.grant.user_id] : []))
      if (decidedUserIds.length > 0) {
        for (const userId of new Set(decidedUserIds)) refresh(userId)
      } else {
        // Nada cambió, pero la causa suele ser que la bandeja quedó vieja (otra persona decidió).
        void queryClient.invalidateQueries({ queryKey: queryKeys.capabilityGrants.pending() })
      }
      const verb = variables.decision === 'approve' ? 'aprobadas' : 'rechazadas'
      const summary = `${result.succeeded} de ${result.requested} solicitudes ${verb}.`
      if (result.failed === 0) {
        toast.success(
          variables.decision === 'approve' ? 'Capacidades aprobadas' : 'Solicitudes rechazadas',
          summary,
        )
      } else if (result.succeeded > 0) {
        toast.push({
          variant: 'warning',
          title: 'Decisión parcial',
          description: `${summary} ${result.failed} con error: ver el detalle.`,
          duration: 8000,
        })
      } else {
        toast.error('No se decidió ninguna solicitud', 'Ver el detalle de cada una en la bandeja.')
      }
    },
    onError: (error) =>
      notifyMutationError(
        toast,
        error,
        ...errorToast('No se pudieron decidir las solicitudes', error, true),
      ),
  })
}
