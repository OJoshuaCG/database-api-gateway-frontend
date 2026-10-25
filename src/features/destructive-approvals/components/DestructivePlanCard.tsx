import { Badge, Callout } from '@/components/ui'
import { type DestructivePlan } from '@/lib/contracts'
import { approvalStatusLabel, approvalStatusTone, directionLabel } from '../messages'
import { scrollToApprovals } from '../anchors'

interface DestructivePlanCardProps {
  plan: DestructivePlan
  /** Dónde está el panel de aprobaciones en esta pantalla; sin panel, el aviso no enlaza. */
  hasApprovalsPanel?: boolean
}

/**
 * Plan destructivo de UNA base, tal como lo devolvió el dry-run: qué versiones destructivas se
 * ejecutarían y si cada una está aprobada. Es solo lectura; ejecutar o aprobar se decide afuera.
 *
 * Tres situaciones, en orden de gravedad: faltan aprobaciones (no se puede seguir), no hay permiso
 * para ejecutar (hay aprobaciones pero falta `blueprints.apply_destructive` o actuó una máquina), o
 * todo listo para confirmar.
 */
export function DestructivePlanCard({ plan, hasApprovalsPanel = true }: DestructivePlanCardProps) {
  const unapproved = plan.versions.filter((version) => version.approval_status !== 'approved')

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-warning/50 bg-warning/5 p-3">
      <p className="text-sm font-medium text-foreground">
        Plan destructivo · {directionLabel(plan.direction)} en «{plan.confirm_name_expected}»
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-background">
        {plan.versions.map((version) => (
          <li key={version.migration_id} className="flex flex-col gap-1 p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-surface-muted px-1.5 py-0.5">{version.version}</code>
              <Badge tone={approvalStatusTone(version.approval_status)}>
                {approvalStatusLabel(version.approval_status)}
              </Badge>
              {version.approval_scope && (
                <span className="text-muted-foreground">
                  aprobada para{' '}
                  {version.approval_scope === 'blueprint' ? 'todo el blueprint' : 'esta base'}
                </span>
              )}
            </div>
            {version.reasons.length > 0 && (
              <span className="text-muted-foreground">{version.reasons.join(', ')}</span>
            )}
          </li>
        ))}
      </ul>

      {unapproved.length > 0 ? (
        <Callout tone="warning" title="Faltan aprobaciones: no se puede ejecutar">
          <p>
            {unapproved.map((version) => version.version).join(', ')}{' '}
            {unapproved.length === 1 ? 'no está aprobada' : 'no están aprobadas'}. Una segunda
            persona tiene que aprobarla
            {unapproved.length === 1 ? '' : 's'} antes de ejecutar.{' '}
            {hasApprovalsPanel && (
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={scrollToApprovals}
              >
                Ir a las aprobaciones →
              </button>
            )}
          </p>
        </Callout>
      ) : !plan.executor_allowed ? (
        <Callout tone="warning" title="No podés ejecutar esta migración">
          <p>
            Está aprobada, pero ejecutarla pide <code>blueprints.apply_destructive</code> en esta
            base y una sesión de persona (un token de agente o de integración no puede). Pedile a un
            owner que la ejecute.
          </p>
        </Callout>
      ) : null}
    </div>
  )
}
