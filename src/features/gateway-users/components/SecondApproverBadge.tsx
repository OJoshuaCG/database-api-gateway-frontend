import { Badge } from '@/components/ui'
import { BOOTSTRAP_WINDOW_BADGE_NOTE, isBootstrapWindowOpen, useSession } from '@/features/auth'
import { SECOND_APPROVER_LABEL } from '../assignment-policy'

interface SecondApproverBadgeProps {
  /**
   * Sumar la nota de la ventana de arranque cuando está abierta. Solo tiene sentido donde el
   * cambio TODAVÍA no se guardó (editores, formularios): en una solicitud ya pendiente, la ventana
   * no la aplica sola y la nota mentiría. Por defecto, sí.
   */
  bootstrapNote?: boolean
}

/**
 * Distintivo de una opción que ELEVA (`needsSecondApprover`): no se bloquea —`access_admin` puede
 * asignarla—, pero al guardar queda pendiente hasta que otra persona con `access_admin` la apruebe.
 * El texto es el motivo completo: no hay `title` que lo esconda de teclado o lector de pantalla.
 *
 * Con la ventana de arranque abierta (C4) el único administrador de accesos la aplica en el acto:
 * se aclara al lado, sin quitar el distintivo, porque es una excepción temporal y la decide el
 * servidor (si ya hay otro administrador con credencial, igual queda pendiente).
 */
export function SecondApproverBadge({ bootstrapNote = true }: SecondApproverBadgeProps) {
  const { admin } = useSession()
  const badge = <Badge tone="warning">{SECOND_APPROVER_LABEL}</Badge>
  if (!bootstrapNote || !isBootstrapWindowOpen(admin)) return badge

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {badge}
      <span className="text-xs text-muted-foreground">{BOOTSTRAP_WINDOW_BADGE_NOTE}</span>
    </span>
  )
}
