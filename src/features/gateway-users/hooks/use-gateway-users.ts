import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import type {
  AcceptInviteIn,
  GatewayUserAccessUpdate,
  GatewayUserCreate,
  GatewayUserUpdate,
} from '@/lib/contracts'
import {
  acceptGatewayUserInvite,
  createGatewayUser,
  getGatewayUser,
  listGatewayUsers,
  reissueGatewayUserInvite,
  replaceGatewayUserAccess,
  updateGatewayUser,
} from '../api/gateway-users.api'
import { gatewayUserErrorMessage } from '../messages'

/** Título + detalle de un error, con el copy del módulo cuando lo reconoce. */
function errorToast(title: string, error: unknown): [string, string] {
  const apiError = toApiError(error)
  return [title, gatewayUserErrorMessage(apiError) ?? apiError.message]
}

export function useGatewayUsers(params: QueryParams) {
  return useQuery({
    queryKey: queryKeys.gatewayUsers.list(params),
    queryFn: ({ signal }) => listGatewayUsers(params, signal),
    placeholderData: keepPreviousData,
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
 * Alta de usuario. **No hace `toast` del token ni lo guarda en caché**: el token de invitación
 * viaja una sola vez y su entrega es una vista propia, no una notificación que se autodestruye a
 * los cinco segundos. El llamador recibe el `GatewayUserCreatedOut` y se encarga de entregarlo.
 */
export function useCreateGatewayUser() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: GatewayUserCreate) => createGatewayUser(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
    },
    onError: (error) => toast.error(...errorToast('No se pudo crear el usuario', error)),
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
  return useMutation({
    mutationFn: (body: GatewayUserUpdate) => updateGatewayUser(id, body),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
      queryClient.setQueryData(queryKeys.gatewayUsers.detail(id), user)
      toast.success('Usuario actualizado', user.username)
    },
    onError: (error) => toast.error(...errorToast('No se pudo actualizar el usuario', error)),
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
  return useMutation({
    mutationFn: (body: GatewayUserAccessUpdate) => replaceGatewayUserAccess(id, body),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
      queryClient.setQueryData(queryKeys.gatewayUsers.detail(id), user)
      toast.success('Accesos actualizados', `Se cerraron las sesiones de ${user.username}.`)
    },
    onError: (error) => toast.error(...errorToast('No se pudieron actualizar los accesos', error)),
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gatewayUsers.all })
      toast.error(...errorToast('No se pudo reemitir la invitación', error))
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
  })
}
