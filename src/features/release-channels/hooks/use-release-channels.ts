import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifyMutationError } from '@/features/auth'
import type { QueryParams } from '@/lib/api/client'
import { toApiError } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/query-keys'
import {
  PAGINATION,
  RELEASE_CHANNEL_ERROR_CODES,
  type ReleaseChannelCreate,
  type ReleaseChannelOut,
  type ReleaseChannelUpdate,
} from '@/lib/contracts'
import { useToast } from '@/lib/toast/use-toast'
import {
  createReleaseChannel,
  deleteReleaseChannel,
  listReleaseChannels,
  updateReleaseChannel,
} from '../api/release-channels.api'

export function useReleaseChannels(params: QueryParams) {
  return useQuery({
    queryKey: queryKeys.releaseChannels.list(params),
    queryFn: ({ signal }) => listReleaseChannels(params, signal),
    placeholderData: keepPreviousData,
  })
}

/**
 * Todos los canales, para los SELECTORES de las pantallas que consumen uno (alta de base,
 * aplicar a todas). Una sola página del tamaño máximo: el catálogo es una lista corta de política
 * (`stable`, `development`…), no un inventario que crezca. `enabled` permite no pedirlo hasta que
 * el selector exista en pantalla.
 */
export function useReleaseChannelOptions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.releaseChannels.list({ options: 'all' }),
    queryFn: ({ signal }) => listReleaseChannels({ page: 1, size: PAGINATION.maxSize }, signal),
    enabled,
    staleTime: 60_000,
    select: (page): ReleaseChannelOut[] => page.items,
  })
}

/**
 * Alta de canal. Sin toast de error: los fallos esperables (409 de nombre o slug repetido, 422 de
 * entorno faltante) se muestran **inline junto al campo** que hay que corregir, y los demás los
 * muestra el formulario con `notifyMutationError`.
 */
export function useCreateReleaseChannel() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ReleaseChannelCreate) => createReleaseChannel(body),
    onSuccess: (channel) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.releaseChannels.all })
      toast.success('Canal creado.', channel.name)
    },
  })
}

/** Edición de canal. Mismo criterio que el alta con los errores de campo. */
export function useUpdateReleaseChannel(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ReleaseChannelUpdate) => updateReleaseChannel(id, body),
    onSuccess: (channel) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.releaseChannels.all })
      toast.success('Canal actualizado.', channel.name)
    },
  })
}

/**
 * Borrado de canal. Un 404 es **éxito idempotente**: el canal ya no está, que es el estado que se
 * pedía. El 422 `confirmation_required` NO se notifica acá: el diálogo lo muestra junto al campo
 * donde se repite el slug.
 */
export function useDeleteReleaseChannel() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ id, confirmSlug }: { id: number; confirmSlug?: string }) =>
      deleteReleaseChannel(id, confirmSlug),
    onSuccess: (message) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.releaseChannels.all })
      toast.success(message ?? 'Canal borrado.')
    },
    onError: (error) => {
      const apiError = toApiError(error)
      if (apiError.code === RELEASE_CHANNEL_ERROR_CODES.notFound) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.releaseChannels.all })
        toast.success('Este canal ya no existía.')
        return
      }
      if (apiError.code === RELEASE_CHANNEL_ERROR_CODES.confirmationRequired) {
        // Se refresca para que `pointer_count` ya sea el real y el diálogo pida el slug.
        void queryClient.invalidateQueries({ queryKey: queryKeys.releaseChannels.all })
        return
      }
      notifyMutationError(toast, error, 'No se pudo borrar el canal', apiError.message)
    },
  })
}
