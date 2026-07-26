import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type {
  AddHostIn,
  AdoptAllHostsIn,
  DefineKnownPasswordIn,
  EnginePasswordChangeAllHostsIn,
  EnginePasswordChangeIn,
  EngineRevealPasswordIn,
  EngineUserCreateIn,
} from '@/lib/contracts'
import {
  addEngineUserHost,
  adoptAllHosts,
  changeEngineUserPassword,
  changeEngineUserPasswordAllHosts,
  createEngineUser,
  defineKnownPassword,
  deleteEngineUser,
  listGroupedEngineUsers,
  revealEngineUserPassword,
} from '../api/servers.api'

export function useGroupedEngineUsers(serverId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.servers.groupedUsers(serverId),
    queryFn: ({ signal }) => listGroupedEngineUsers(serverId, signal),
    enabled,
  })
}

/**
 * Toda escritura por identidad puede alterar tanto la vista agrupada del servidor como el
 * inventario (`/server-users`, p. ej. `status`/`has_password`): se invalidan ambas.
 */
function useInvalidateEngineUsers(serverId: number) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.servers.groupedUsers(serverId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.serverUsers.all })
  }
}

export function useCreateEngineUser(serverId: number) {
  const invalidate = useInvalidateEngineUsers(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (body: EngineUserCreateIn) => createEngineUser(serverId, body),
    onSuccess: (result) => {
      invalidate()
      toast.success('Usuario creado en el motor 🔌', result.username)
    },
    onError: (error) => toast.error('No se pudo crear el usuario', toApiError(error).message),
  })
}

export function useChangeEngineUserPassword(serverId: number) {
  const invalidate = useInvalidateEngineUsers(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (body: EnginePasswordChangeIn) => changeEngineUserPassword(serverId, body),
    onSuccess: (result) => {
      invalidate()
      toast.success('Contraseña actualizada 🔌', result.username)
    },
    onError: (error) => toast.error('No se pudo cambiar la contraseña', toApiError(error).message),
  })
}

export function useDeleteEngineUser(serverId: number) {
  const invalidate = useInvalidateEngineUsers(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (options: { username: string; host?: string; confirmUsername: string }) =>
      deleteEngineUser(serverId, options),
    onSuccess: (_, { username }) => {
      invalidate()
      toast.success('Usuario eliminado del motor 🔌', username)
    },
    onError: (error) => toast.error('No se pudo eliminar el usuario', toApiError(error).message),
  })
}

export function useAddEngineUserHost(serverId: number) {
  const invalidate = useInvalidateEngineUsers(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (body: AddHostIn) => addEngineUserHost(serverId, body),
    onSuccess: (result) => {
      invalidate()
      if (result.grants_error) {
        toast.error(
          `Host «${result.new_host}» creado, pero algún permiso no se copió`,
          result.grants_error,
        )
      } else {
        toast.success(`Host «${result.new_host}» agregado 🔌`, result.username)
      }
    },
    onError: (error) => toast.error('No se pudo agregar el host', toApiError(error).message),
  })
}

// ── Operaciones batch por username (§7.4) — el desenlace real vive en `results[]` ───────────

/**
 * `adopt-all-hosts` 🔌 — adopta todas las identidades en vivo de un username. `already_adopted`
 * no es error: el toast resume nuevas vs. ya adoptadas y el modal pinta el detalle por host.
 */
export function useAdoptAllHosts(serverId: number) {
  const invalidate = useInvalidateEngineUsers(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (body: AdoptAllHostsIn) => adoptAllHosts(serverId, body),
    onSuccess: (result) => {
      invalidate()
      const already = result.total_hosts - result.adopted
      toast.success(
        `«${result.username}»: ${result.adopted} identidad(es) adoptada(s)`,
        already > 0 ? `${already} ya estaba(n) en el inventario.` : undefined,
      )
    },
    onError: (error) =>
      toast.error('No se pudieron adoptar las identidades', toApiError(error).message),
  })
}

/**
 * `define-password` — guarda una contraseña YA conocida sin tocar el motor (nunca `ALTER USER`).
 * `conflict_needs_overwrite` no es error: se resume como advertencia y el modal ofrece reenviar
 * con `overwrite=true`.
 */
export function useDefineKnownPassword(serverId: number) {
  const invalidate = useInvalidateEngineUsers(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (body: DefineKnownPasswordIn) => defineKnownPassword(serverId, body),
    onSuccess: (result) => {
      invalidate()
      const saved = result.results.filter(
        (item) => item.status === 'updated' || item.status === 'adopted',
      ).length
      const conflicts = result.results.filter(
        (item) => item.status === 'conflict_needs_overwrite',
      ).length
      if (conflicts > 0) {
        toast.push({
          variant: 'warning',
          title: 'Contraseña guardada parcialmente',
          description: `${saved} identidad(es) actualizada(s); ${conflicts} ya tenía(n) una contraseña guardada (requieren sobrescribir).`,
        })
      } else {
        toast.success(
          'Contraseña conocida guardada',
          `${result.username}: ${saved} identidad(es), sin tocar el motor.`,
        )
      }
    },
    onError: (error) => toast.error('No se pudo guardar la contraseña', toApiError(error).message),
  })
}

/**
 * `password-all-hosts` 🔌 — `ALTER USER/ROLE` REAL en todos los hosts en vivo. Un host con
 * `status='error'` conserva la contraseña ANTERIOR: jamás se emite un éxito genérico si hubo
 * fallo parcial (el modal pinta el detalle por host).
 */
export function useChangeEngineUserPasswordAllHosts(serverId: number) {
  const invalidate = useInvalidateEngineUsers(serverId)
  const toast = useToast()
  return useMutation({
    mutationFn: (body: EnginePasswordChangeAllHostsIn) =>
      changeEngineUserPasswordAllHosts(serverId, body),
    onSuccess: (result) => {
      invalidate()
      const failed = result.results.filter((item) => item.status === 'error').length
      if (failed > 0) {
        toast.push({
          variant: 'warning',
          title: `Rotación parcial: ${failed} de ${result.total_hosts} host(s) fallaron`,
          description:
            'Los hosts con error conservan la contraseña anterior en el motor. Revisa el detalle por host.',
        })
      } else {
        toast.success(
          'Contraseña rotada en todos los hosts 🔌',
          `${result.username}: ${result.updated} identidad(es).`,
        )
      }
    },
    onError: (error) => toast.error('No se pudo rotar la contraseña', toApiError(error).message),
  })
}

/**
 * Revela un secreto efímero: deliberadamente NO invalida ni cachea nada (React Query nunca
 * debe guardar una contraseña en claro). El resultado vive solo en el estado del componente
 * que lo solicitó, mientras el diálogo permanece abierto.
 */
export function useRevealEngineUserPassword(serverId: number) {
  const toast = useToast()
  return useMutation({
    mutationFn: (body: EngineRevealPasswordIn) => revealEngineUserPassword(serverId, body),
    onError: (error) => toast.error('No se pudo revelar la contraseña', toApiError(error).message),
  })
}
