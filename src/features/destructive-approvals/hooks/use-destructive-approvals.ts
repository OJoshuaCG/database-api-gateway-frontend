import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifyMutationError } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/query-keys'
import {
  DESTRUCTIVE_APPROVAL_ERROR_CODES as CODES,
  SELF_APPROVAL_FORBIDDEN_CODE,
  type ApproveDestructiveInput,
  type DestructiveApproval,
} from '@/lib/contracts'
import { useToast } from '@/lib/toast/use-toast'
import {
  approveDestructiveForBlueprint,
  approveDestructiveForDatabase,
  listDestructiveVersions,
  revokeDestructiveApproval,
} from '../api/destructive-approvals.api'

/**
 * Versiones destructivas del blueprint con su estado de aprobación. Con `managedDatabaseId` el
 * estado se evalúa para esa base (lo que decide si el apply de ESA base queda habilitado).
 */
export function useDestructiveVersions(
  modelId: number,
  managedDatabaseId: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.destructiveApprovals.versions(modelId, managedDatabaseId),
    queryFn: ({ signal }) => listDestructiveVersions(modelId, managedDatabaseId, signal),
    enabled,
  })
}

/**
 * Códigos que el diálogo pinta junto al formulario. Ningún toast para ellos: el toast diría lo
 * mismo que el `Callout` y, con dos mensajes a la vez, gana el que está al lado de lo que hay
 * que corregir.
 */
const FORM_LEVEL_CODES: ReadonlySet<string> = new Set([
  SELF_APPROVAL_FORBIDDEN_CODE,
  CODES.sqlChanged,
  CODES.duplicate,
  CODES.machineActor,
  CODES.notDestructive,
  CODES.downSqlMissing,
  CODES.scopeInvalid,
  CODES.notFound,
])

/**
 * Aprobar y revocar cambian el `approval_status` que lee TODA pantalla de migraciones, así que se
 * invalida el prefijo del blueprint. Se invalidan también las vistas de estado de las bases: el
 * botón de aplicar se habilita o deshabilita con este dato.
 */
function useInvalidateApprovals(modelId: number) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.destructiveApprovals.byModel(modelId),
    })
    void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.migrations(modelId) })
  }
}

export interface ApproveVariables {
  version: string
  input: ApproveDestructiveInput
  /** Sin base = alcance blueprint; con base = alcance base. */
  managedDatabaseId?: number
}

export function useApproveDestructive(modelId: number) {
  const toast = useToast()
  const invalidate = useInvalidateApprovals(modelId)
  return useMutation<DestructiveApproval, unknown, ApproveVariables>({
    mutationFn: ({ version, input, managedDatabaseId }) =>
      managedDatabaseId === undefined
        ? approveDestructiveForBlueprint(modelId, version, input)
        : approveDestructiveForDatabase(managedDatabaseId, version, input),
    onSuccess: (approval) => {
      invalidate()
      toast.success(
        'Migración destructiva aprobada.',
        `Versión ${approval.version} (${approval.direction === 'down' ? 'rollback' : 'apply'}).`,
      )
    },
    onError: (error) => {
      const apiError = toApiError(error)
      if (apiError.code !== undefined && FORM_LEVEL_CODES.has(apiError.code)) {
        // El SQL cambió o la versión ya no existe: la lista que se ve está vieja.
        if (apiError.code === CODES.sqlChanged || apiError.code === CODES.notFound) invalidate()
        return
      }
      notifyMutationError(toast, error, 'No se pudo aprobar la migración', apiError.message)
    },
  })
}

export interface RevokeVariables {
  approvalId: number
  reason: string
}

export function useRevokeDestructiveApproval(modelId: number) {
  const toast = useToast()
  const invalidate = useInvalidateApprovals(modelId)
  return useMutation<DestructiveApproval, unknown, RevokeVariables>({
    mutationFn: ({ approvalId, reason }) => revokeDestructiveApproval(approvalId, reason),
    onSuccess: () => {
      invalidate()
      toast.success('Aprobación revocada.', 'La próxima ejecución vuelve a quedar bloqueada.')
    },
    onError: (error) => {
      const apiError = toApiError(error)
      if (apiError.code === CODES.notFound) {
        invalidate()
        return
      }
      notifyMutationError(toast, error, 'No se pudo revocar la aprobación', apiError.message)
    },
  })
}
