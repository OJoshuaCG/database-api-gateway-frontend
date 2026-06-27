import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import type { PermissionProfileCreate, PermissionProfileUpdate } from '@/lib/contracts'
import {
  createPermissionProfile,
  deletePermissionProfile,
  getPermissionProfile,
  listPermissionProfiles,
  updatePermissionProfile,
} from '../api/permission-profiles.api'

export function usePermissionProfiles(params: QueryParams) {
  return useQuery({
    queryKey: queryKeys.permissionProfiles.list(params),
    queryFn: ({ signal }) => listPermissionProfiles(params, signal),
  })
}

export function usePermissionProfile(id: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.permissionProfiles.detail(id),
    queryFn: ({ signal }) => getPermissionProfile(id, signal),
    enabled,
  })
}

export function useCreatePermissionProfile() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: PermissionProfileCreate) => createPermissionProfile(body),
    onSuccess: (profile) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.permissionProfiles.all })
      toast.success('Perfil de permisos creado', `${profile.name} (${profile.engine})`)
    },
    onError: (error) => toast.error('No se pudo crear el perfil', toApiError(error).message),
  })
}

export function useUpdatePermissionProfile(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: PermissionProfileUpdate) => updatePermissionProfile(id, body),
    onSuccess: (profile) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.permissionProfiles.all })
      queryClient.setQueryData(queryKeys.permissionProfiles.detail(id), profile)
      toast.success('Perfil actualizado', profile.name)
    },
    onError: (error) => toast.error('No se pudo actualizar el perfil', toApiError(error).message),
  })
}

export function useDeletePermissionProfile() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (id: number) => deletePermissionProfile(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.permissionProfiles.all })
      toast.success('Perfil eliminado')
    },
    onError: (error) => toast.error('No se pudo eliminar el perfil', toApiError(error).message),
  })
}
