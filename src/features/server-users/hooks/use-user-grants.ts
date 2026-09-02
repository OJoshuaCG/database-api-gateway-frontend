import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type {
  ApplyProfileBulkItem,
  ApplyProfileRequest,
  GrantRequest,
  ObjectMapping,
  RevokeRequest,
} from '@/lib/contracts'
import {
  BULK_CHUNK_SIZE,
  chunk,
  type FanOutOutcome,
  type GrantFanOutItem,
} from '../components/grant-logic'
import {
  applyProfile,
  applyProfileBulk,
  grantPrivileges,
  listUserGrants,
  revokePrivileges,
} from '../api/server-users.api'

/**
 * Permisos efectivos del usuario **adoptado** (introspección del motor) 🔌. Para una identidad
 * sin fila de inventario está `useIdentityGrants` (v21 §1), que no exige adopción; el contrato
 * es explícito en que el nuevo endpoint **no reemplaza** a este (§2): con la fila en la mano,
 * este sigue siendo el camino natural.
 *
 * En PostgreSQL el backend exige `?database=` (grants de objeto): con `requiresDatabase=true` la
 * query no se dispara hasta que haya una BD indicada — la UI muestra el hint correspondiente.
 */
export function useUserGrants(
  id: number,
  database: string | undefined,
  enabled: boolean,
  requiresDatabase = false,
) {
  return useQuery({
    queryKey: queryKeys.serverUsers.grants(id, database ?? null),
    queryFn: ({ signal }) => listUserGrants(id, database, signal),
    enabled: enabled && (!requiresDatabase || Boolean(database)),
  })
}

/**
 * Invalida las DOS vistas de permisos del usuario: la de inventario (`/server-users/{id}/grants`)
 * y la de identidad (`/servers/{serverId}/users/grants`). Son endpoints distintos con caché
 * distinta sobre el mismo estado del motor: refrescar solo una dejaría la otra pestaña mintiendo.
 */
function invalidateGrants(
  queryClient: ReturnType<typeof useQueryClient>,
  id: number,
  serverId: number,
): void {
  void queryClient.invalidateQueries({ queryKey: ['server-users', id, 'grants'] })
  void queryClient.invalidateQueries({ queryKey: ['servers', serverId, 'identity-grants'] })
}

// ── Fan-out por base de datos (v21 §12) ─────────────────────────────────────

/**
 * Ejecuta las llamadas **en serie**, no con `Promise.all`.
 *
 * Cada grant abre su propia conexión remota contra el motor; disparar N en paralelo multiplica
 * las conexiones simultáneas justo sobre el recurso más escaso, que es exactamente lo que el
 * contrato pide evitar cuando explica la cota del bulk (v21 §11).
 */
async function runInSeries<TBody>(
  items: GrantFanOutItem<TBody>[],
  call: (body: TBody) => Promise<unknown>,
): Promise<FanOutOutcome[]> {
  const outcomes: FanOutOutcome[] = []
  for (const item of items) {
    try {
      await call(item.body)
      outcomes.push({ label: item.label, ok: true })
    } catch (error) {
      outcomes.push({ label: item.label, ok: false, error: toApiError(error).message })
    }
  }
  return outcomes
}

/** Cuenta cuántas unidades salieron bien; sirve para redactar el toast sin repetir el filtro. */
function countOk(outcomes: FanOutOutcome[]): number {
  return outcomes.filter((outcome) => outcome.ok).length
}

/**
 * Otorga los mismos privilegios sobre una o varias bases 🔌 (v21 §7 + §12).
 *
 * Devuelve **siempre** un resultado por base y nunca rechaza la mutación por un fallo suelto:
 * si de 8 bases fallan 2, el operador necesita ver cuáles fallaron y saber que las otras 6 ya
 * están otorgadas — un `throw` global escondería justo eso y sugeriría reintentar el lote entero.
 */
export function useGrantPrivilegesToDatabases(id: number, serverId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (items: GrantFanOutItem<GrantRequest>[]) =>
      runInSeries(items, (body) => grantPrivileges(id, body)),
    onSuccess: (outcomes) => {
      invalidateGrants(queryClient, id, serverId)
      const ok = countOk(outcomes)
      if (ok === outcomes.length) {
        toast.success('Privilegios otorgados', `${ok} de ${outcomes.length} destino(s).`)
      } else {
        toast.error(
          `Otorgado en ${ok} de ${outcomes.length} destino(s)`,
          'Revisá el detalle por base debajo del formulario.',
        )
      }
    },
    onError: (error) =>
      toast.error('No se pudieron otorgar los privilegios', toApiError(error).message),
  })
}

/** Revoca los mismos privilegios sobre una o varias bases 🔌 (v21 §7). Mismo criterio de fan-out. */
export function useRevokePrivilegesFromDatabases(id: number, serverId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({
      items,
      confirmGrantee,
    }: {
      items: GrantFanOutItem<RevokeRequest>[]
      confirmGrantee?: string
    }) => runInSeries(items, (body) => revokePrivileges(id, body, confirmGrantee)),
    onSuccess: (outcomes) => {
      invalidateGrants(queryClient, id, serverId)
      const ok = countOk(outcomes)
      if (ok === outcomes.length) {
        toast.success('Privilegios revocados', `${ok} de ${outcomes.length} destino(s).`)
      } else {
        toast.error(
          `Revocado en ${ok} de ${outcomes.length} destino(s)`,
          'Revisá el detalle por base debajo del formulario.',
        )
      }
    },
    onError: (error) =>
      toast.error('No se pudieron revocar los privilegios', toApiError(error).message),
  })
}

// ── Perfiles de permisos (v21 §9 y §11) ─────────────────────────────────────

/**
 * Aplica un perfil **sin base de datos**: el caso de un perfil cuyos items son todos `global`.
 * Para uno o más destinos con base está `useApplyProfileToDatabases`, que usa el bulk.
 */
export function useApplyProfile(id: number, serverId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ profileId, body }: { profileId: number; body: ApplyProfileRequest }) =>
      applyProfile(id, profileId, body),
    onSuccess: (result) => {
      invalidateGrants(queryClient, id, serverId)
      if (result.errors.length > 0) {
        toast.error(
          `Perfil aplicado con ${result.errors.length} error(es)`,
          `${result.grants_applied} grant(s) aplicado(s). ${result.errors.join('; ')}`,
        )
      } else {
        toast.success(
          'Perfil aplicado',
          `${result.profile_name}: ${result.grants_applied} grant(s) aplicado(s)`,
        )
      }
    },
    onError: (error) => toast.error('No se pudo aplicar el perfil', toApiError(error).message),
  })
}

/** Lo que la pantalla necesita saber del lote, ya agregado sobre todas las tandas. */
export interface ApplyProfileBulkSummary {
  profileName: string
  results: ApplyProfileBulkItem[]
  grantsApplied: number
}

/**
 * Aplica un perfil a N bases 🔌 (v21 §11), partiendo la selección en **tandas de 20**.
 *
 * Las tandas no son una precaución genérica: el endpoint acepta hasta 100 bases pero está
 * limitado a 5 llamadas por minuto, y su latencia crece con `bases × niveles` porque cada
 * `can_grant` + `grant_object` abre su propia conexión remota. 100 bases en tandas de 20 son
 * exactamente 5 llamadas — el máximo que la cota permite sin quedarse a mitad.
 *
 * Las tandas van **en serie** por el mismo motivo, y el resultado se concatena en el orden de la
 * selección para que la tabla de resultados se lea igual que la lista que el operador marcó.
 */
export function useApplyProfileToDatabases(id: number, serverId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async ({
      profileId,
      databases,
      objectMappings,
    }: {
      profileId: number
      databases: string[]
      objectMappings: ObjectMapping[]
    }): Promise<ApplyProfileBulkSummary> => {
      let profileName = ''
      const results: ApplyProfileBulkItem[] = []
      for (const batch of chunk(databases, BULK_CHUNK_SIZE)) {
        const result = await applyProfileBulk(id, profileId, {
          databases: batch,
          object_mappings: objectMappings,
        })
        profileName = result.profile_name
        results.push(...result.results)
      }
      return {
        profileName,
        results,
        grantsApplied: results.reduce((total, item) => total + item.grants_applied, 0),
      }
    },
    onSuccess: (summary) => {
      invalidateGrants(queryClient, id, serverId)
      // El bulk responde 200 aunque TODAS las bases hayan fallado (v21 §11): el éxito se decide
      // por `results[].ok`, nunca por el status HTTP.
      const ok = summary.results.filter((item) => item.ok).length
      if (ok === summary.results.length) {
        toast.success(
          'Perfil aplicado',
          `${summary.profileName}: ${summary.grantsApplied} grant(s) en ${ok} base(s).`,
        )
      } else {
        toast.error(
          `Perfil aplicado en ${ok} de ${summary.results.length} base(s)`,
          'Revisá el detalle por base debajo del formulario.',
        )
      }
    },
    onError: (error) => toast.error('No se pudo aplicar el perfil', toApiError(error).message),
  })
}
