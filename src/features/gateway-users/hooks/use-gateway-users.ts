import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import {
  pendingElevationOf,
  type AcceptInviteIn,
  type AccessRequest,
  type GatewayUserAccessUpdate,
  type GatewayUserCreate,
  type GatewayUserUpdate,
} from '@/lib/contracts'
import { accessRequestPath } from '@/lib/routes'
import {
  acceptGatewayUserInvite,
  createGatewayUser,
  getGatewayUser,
  listGatewayUsers,
  reissueGatewayUserInvite,
  replaceGatewayUserAccess,
  updateGatewayUser,
} from '../api/gateway-users.api'
import { ELEVATION_PENDING_MESSAGE, gatewayUserErrorMessage } from '../messages'
import { notifyMutationError } from '@/features/auth'

/** Título + detalle de un error, con el copy del módulo cuando lo reconoce. */
function errorToast(title: string, error: unknown): [string, string] {
  const apiError = toApiError(error)
  return [title, gatewayUserErrorMessage(apiError) ?? apiError.message]
}

/**
 * Aviso del `202 access.elevation_pending` (v29 §9.3), común a los tres escritores. Más largo que un
 * éxito y en `warning`: dice que NO todo rige todavía, y lleva a la solicitud en la bandeja. El
 * enlace es un `href` (el proveedor de toasts vive fuera del router), así que recarga, que trae la
 * bandeja fresca de todas formas.
 */
function useNotifyElevationPending() {
  const toast = useToast()
  const queryClient = useQueryClient()
  return (request: AccessRequest) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.accessRequests.all })
    toast.push({
      variant: 'warning',
      title: `Elevación pendiente para ${request.target.username}`,
      description: ELEVATION_PENDING_MESSAGE,
      action: { label: 'Ver la solicitud', href: accessRequestPath(request.id) },
      duration: 10_000,
    })
  }
}

/**
 * `enabled` lo apaga quien no tiene `access.admin` (o no está en la pestaña del listado): el
 * pedido sería un 403 seguro, y además es ruido en el log de auditoría del backend.
 */
export function useGatewayUsers(params: QueryParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.gatewayUsers.list(params),
    queryFn: ({ signal }) => listGatewayUsers(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useGatewayUser(id: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.gatewayUsers.detail(id),
    queryFn: ({ signal }) => getGatewayUser(id, signal),
    enabled,
  })
}

/**
 * Alta de usuario. **No hace `toast` del token ni lo escribe en ninguna query**: el token de
 * invitación viaja una sola vez y su entrega es una vista propia, no una notificación que se
 * autodestruye a los cinco segundos. El llamador recibe el `GatewayUserCreatedOut` y se encarga de
 * entregarlo.
 *
 * Eso no bastaba para que el token no quedara guardado: una mutación conserva su respuesta en el
 * MutationCache aunque nadie la lea, cinco minutos por defecto. `gcTime: 0` la descarta en cuanto
 * el formulario de alta se desmonta, que es justo cuando se abre la entrega.
 */
export function useCreateGatewayUser() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const notifyPending = useNotifyElevationPending()
  return useMutation({
    mutationFn: (body: GatewayUserCreate) => createGatewayUser(body),
    gcTime: 0,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
      // 202: la cuenta nació sin la elevación (y la invitación igual). La entrega del token la
      // repite fija; el toast es para quien no llega a leerla.
      const pending = pendingElevationOf(created)
      if (pending) notifyPending(pending)
    },
    onError: (error) =>
      notifyMutationError(toast, error, ...errorToast('No se pudo crear el usuario', error)),
  })
}

/**
 * Edición. ⚠️ Cambiar el rol o desactivar **tacha las sesiones** de esa persona: si un
 * administrador se edita a sí mismo, vuelve al login. La advertencia previa la da el formulario;
 * acá solo se refresca el inventario.
 */
export function useUpdateGatewayUser(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const notifyPending = useNotifyElevationPending()
  return useMutation({
    mutationFn: (body: GatewayUserUpdate) => updateGatewayUser(id, body),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
      // Un cambio de rol (con o sin `sod_override`) mueve las excepciones de separación de deberes.
      void queryClient.invalidateQueries({ queryKey: queryKeys.authz.sodReport() })
      // `data` es la persona tal como quedó YA (en un 202, sin la elevación): sirve igual de caché.
      queryClient.setQueryData(queryKeys.gatewayUsers.detail(id), user)
      const pending = pendingElevationOf(user)
      if (pending) notifyPending(pending)
      else toast.success('Usuario actualizado', user.username)
    },
    onError: (error) =>
      notifyMutationError(toast, error, ...errorToast('No se pudo actualizar el usuario', error)),
  })
}

/**
 * Reemplazo TOTAL de accesos (§2.6). El cuerpo tiene que traer el estado completo: el contrato
 * `GatewayUserAccessUpdate` exige los dos campos justamente para que no se pueda mandar un delta.
 * También tacha las sesiones de la persona afectada.
 */
export function useReplaceGatewayUserAccess(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const notifyPending = useNotifyElevationPending()
  return useMutation({
    mutationFn: (body: GatewayUserAccessUpdate) => replaceGatewayUserAccess(id, body),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
      // El acceso efectivo del servidor depende de roles y globales: quedó viejo con este reemplazo.
      void queryClient.invalidateQueries({ queryKey: queryKeys.capabilityGrants.effective(id) })
      // Un override crea excepciones y un cambio que deja de violar una regla cierra la suya.
      void queryClient.invalidateQueries({ queryKey: queryKeys.authz.sodReport() })
      queryClient.setQueryData(queryKeys.gatewayUsers.detail(id), user)
      const pending = pendingElevationOf(user)
      if (pending) notifyPending(pending)
      else toast.success('Accesos actualizados', `Se cerraron las sesiones de ${user.username}.`)
    },
    onError: (error) =>
      notifyMutationError(
        toast,
        error,
        ...errorToast('No se pudieron actualizar los accesos', error),
      ),
  })
}

/**
 * Reinvitar. Emitir una invitación nueva **invalida la anterior** (sube el `credential_epoch`),
 * así que esta es también la única forma de revocar una que se filtró por un canal equivocado.
 *
 * El 409 `credential_already_set` se trata refrescando el listado: significa que la cuenta ya fijó
 * contraseña, o sea que nuestra copia del `credential_set` estaba vieja y el botón no debería
 * haberse mostrado.
 */
export function useReissueGatewayUserInvite() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (id: number) => reissueGatewayUserInvite(id),
    // El token nuevo vive en la respuesta. Este hook queda montado con el listado, así que además
    // del `gcTime: 0` el llamador hace `reset()` al cerrar la entrega (ver `GatewayUsersPage`).
    gcTime: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
      notifyMutationError(toast, error, ...errorToast('No se pudo reemitir la invitación', error))
    },
  })
}

/**
 * Aceptar la invitación — **público**: sin sesión, sin CSRF y sin caché que invalidar.
 *
 * No hay `toast` de error acá: esta mutación la consume una pantalla que está fuera del área
 * autenticada, donde el error tiene que quedar FIJO en el formulario (un toast que se va solo deja
 * a alguien que no puede entrar sin saber por qué). El copy sale de `acceptInviteErrorMessage`.
 */
export function useAcceptGatewayUserInvite() {
  return useMutation({
    mutationFn: (body: AcceptInviteIn) => acceptGatewayUserInvite(body),
    // Las variables llevan el token de invitación y la contraseña nueva en claro.
    gcTime: 0,
  })
}
