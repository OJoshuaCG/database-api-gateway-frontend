import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type {
  CharsetCollationOptionCreate,
  CharsetCollationOptionUpdate,
  EngineFamily,
} from '@/lib/contracts'
import {
  createCharsetCollationOption,
  listCharsetCollationOptions,
  updateCharsetCollationOption,
} from '../api/charset-collation-options.api'

export function useCharsetCollationOptions(params?: {
  engine_family?: EngineFamily
  only_enabled?: boolean
}) {
  return useQuery({
    queryKey: queryKeys.charsetCollationOptions.list(params ?? {}),
    queryFn: ({ signal }) => listCharsetCollationOptions(params, signal),
  })
}

export function useCreateCharsetCollationOption() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: CharsetCollationOptionCreate) => createCharsetCollationOption(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.charsetCollationOptions.all })
      toast.success('Combinación agregada al catálogo.')
    },
    onError: (error) =>
      toast.error('No se pudo agregar la combinación', toApiError(error).message),
  })
}

export function useUpdateCharsetCollationOption() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: CharsetCollationOptionUpdate }) =>
      updateCharsetCollationOption(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.charsetCollationOptions.all })
      toast.success('Catálogo actualizado.')
    },
    onError: (error) =>
      toast.error('No se pudo actualizar el catálogo', toApiError(error).message),
  })
}
