import { useState } from 'react'
import { Button, Callout, Modal, Textarea } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import {
  APPROVAL_REASON_MAX_LENGTH,
  APPROVAL_REASON_MIN_LENGTH,
  type DestructiveApproval,
} from '@/lib/contracts'
import { useRevokeDestructiveApproval } from '../hooks/use-destructive-approvals'
import { destructiveApprovalMessage, directionLabel } from '../messages'

interface RevokeApprovalDialogProps {
  modelId: number
  approval: DestructiveApproval
  onClose: () => void
}

/**
 * Revoca una aprobación. No hay chequeo de capacidad en pantalla ni step-up: el servidor deja
 * revocar a quien aprobó, a quien tenga `approve_destructive` en ese alcance y a un owner, y
 * revocar frena una operación destructiva, así que nunca puede costar más que lanzarla. Si el
 * actor no puede, responde 403 y se muestra acá.
 *
 * Es idempotente: revocar una aprobación ya revocada responde 200 sin cambiar nada.
 */
export function RevokeApprovalDialog({ modelId, approval, onClose }: RevokeApprovalDialogProps) {
  const [reason, setReason] = useState('')
  const revoke = useRevokeDestructiveApproval(modelId)

  const trimmedReason = reason.trim()
  const reasonValid =
    trimmedReason.length >= APPROVAL_REASON_MIN_LENGTH &&
    trimmedReason.length <= APPROVAL_REASON_MAX_LENGTH
  const rejection = revoke.isError ? toApiError(revoke.error) : null
  const isBlueprintScope = approval.scope === 'blueprint'

  return (
    <Modal
      open
      onClose={onClose}
      title={`Revocar la aprobación de la versión ${approval.version}`}
      description={`${directionLabel(approval.direction)} · alcance ${isBlueprintScope ? 'blueprint' : 'una base'}`}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={revoke.isPending}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={!reasonValid || revoke.isPending}
            isLoading={revoke.isPending}
            onClick={() =>
              revoke.mutate(
                { approvalId: approval.id, reason: trimmedReason },
                { onSuccess: onClose },
              )
            }
          >
            Revocar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {isBlueprintScope
            ? 'Todas las bases protegidas del blueprint pierden esta aprobación.'
            : 'Esta base pierde la aprobación.'}{' '}
          La próxima ejecución de la versión vuelve a quedar bloqueada. Lo que ya se aplicó no se
          toca.
        </p>
        <Textarea
          label="Motivo de la revocación"
          rows={3}
          maxLength={APPROVAL_REASON_MAX_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint={`Entre ${APPROVAL_REASON_MIN_LENGTH} y ${APPROVAL_REASON_MAX_LENGTH} caracteres. Queda en la auditoría.`}
        />
        {rejection && (
          <Callout tone="danger" title="No se pudo revocar">
            <p>
              {destructiveApprovalMessage(rejection.code, rejection.selfApprovalRule) ??
                rejection.message}
            </p>
          </Callout>
        )}
      </div>
    </Modal>
  )
}
