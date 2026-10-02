import { Badge } from '@/components/ui'
import { SECOND_APPROVER_LABEL } from '../assignment-policy'

/**
 * Distintivo de una opción que ELEVA (`needsSecondApprover`): no se bloquea —`access_admin` puede
 * asignarla—, pero al guardar queda pendiente hasta que otra persona con `access_admin` la apruebe.
 * El texto es el motivo completo: no hay `title` que lo esconda de teclado o lector de pantalla.
 */
export function SecondApproverBadge() {
  return <Badge tone="warning">{SECOND_APPROVER_LABEL}</Badge>
}
