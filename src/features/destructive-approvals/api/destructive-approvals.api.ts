import { fetchList, mutateData } from '@/lib/api/client'
import {
  destructiveApprovalSchema,
  destructiveVersionSchema,
  type ApproveDestructiveInput,
  type DestructiveApproval,
  type DestructiveVersion,
} from '@/lib/contracts'

/**
 * `GET /database-models/{id}/destructive-versions` — versiones destructivas del blueprint, una
 * fila por dirección. Con `managedDatabaseId` el `approval_status` se evalúa para esa base; sin
 * él, solo cuentan las aprobaciones de alcance blueprint.
 */
export function listDestructiveVersions(
  modelId: number,
  managedDatabaseId: number | null,
  signal?: AbortSignal,
): Promise<DestructiveVersion[]> {
  return fetchList(`/database-models/${modelId}/destructive-versions`, destructiveVersionSchema, {
    query: { managed_database_id: managedDatabaseId ?? undefined },
    signal,
  })
}

function approvalBody(input: ApproveDestructiveInput) {
  return {
    direction: input.direction,
    expected_sql_hash: input.expectedSqlHash,
    reason: input.reason.trim(),
  }
}

/**
 * `POST /database-models/{id}/migrations/{version}/destructive-approvals` — aprueba para TODAS
 * las bases protegidas del blueprint (incluidas las futuras). Pide `blueprints.approve_destructive`
 * en cada entorno que bloquea, más step-up.
 */
export function approveDestructiveForBlueprint(
  modelId: number,
  version: string,
  input: ApproveDestructiveInput,
): Promise<DestructiveApproval> {
  return mutateData(
    'POST',
    `/database-models/${modelId}/migrations/${encodeURIComponent(version)}/destructive-approvals`,
    destructiveApprovalSchema,
    { body: approvalBody(input) },
  )
}

/**
 * `POST /managed-databases/{id}/migrations/{version}/destructive-approvals` — aprueba SOLO para
 * esa base. Mismas reglas y errores que el alcance blueprint.
 */
export function approveDestructiveForDatabase(
  managedDatabaseId: number,
  version: string,
  input: ApproveDestructiveInput,
): Promise<DestructiveApproval> {
  return mutateData(
    'POST',
    `/managed-databases/${managedDatabaseId}/migrations/${encodeURIComponent(version)}/destructive-approvals`,
    destructiveApprovalSchema,
    { body: approvalBody(input) },
  )
}

/**
 * `POST /destructive-approvals/{id}/revoke` — NO exige step-up (revocar frena una operación y no
 * puede costar más que lanzarla). Idempotente: revocar algo ya revocado responde 200 igual.
 */
export function revokeDestructiveApproval(
  approvalId: number,
  reason: string,
): Promise<DestructiveApproval> {
  return mutateData(
    'POST',
    `/destructive-approvals/${approvalId}/revoke`,
    destructiveApprovalSchema,
    {
      body: { reason: reason.trim() },
    },
  )
}
