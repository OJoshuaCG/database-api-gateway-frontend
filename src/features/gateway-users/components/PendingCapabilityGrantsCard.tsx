import { useCallback, useId, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Textarea,
} from '@/components/ui'
import {
  ForbiddenState,
  forbiddenCopy,
  isAccessForbidden,
  useCapabilityCatalog,
} from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import type { PendingCapabilityGrant, ScopeType } from '@/lib/contracts'
import { formatDateTime } from '@/lib/utils/format'
import {
  useApproveCapabilityGrant,
  usePendingCapabilityGrants,
  useRejectCapabilityGrant,
} from '../hooks/use-capability-grants'
import { capabilityGrantBlockedMessage, capabilityGrantErrorMessage } from '../messages'

/** Largo máximo del motivo de la decisión: el mismo tope que el contrato y el backend. */
const REASON_MAX = 500

const SCOPE_TYPE_LABELS: Record<ScopeType, string> = {
  environment: 'Entorno',
  server: 'Servidor',
}

/** «Servidor · db-prod-01»; si el destino ya no existe el backend manda `null` y va el id. */
function scopeLabel(grant: Pick<PendingCapabilityGrant, 'scope_type' | 'scope_id' | 'scope_name'>) {
  const type = SCOPE_TYPE_LABELS[grant.scope_type as ScopeType] ?? grant.scope_type
  return `${type} · ${grant.scope_name ?? `#${grant.scope_id}`}`
}

type Decision = { kind: 'approve' | 'reject'; grant: PendingCapabilityGrant }

/**
 * Bandeja de capacidades puntuales sensibles que esperan una segunda aprobación (api-reference
 * §19). Solo la ve quien tiene `access.admin`: quien la monta lo decide, acá no se vuelve a preguntar.
 *
 * **`can_decide` y `blocked_reason` son del servidor.** La UI no recalcula quién pidió ni qué
 * puede asignar quien mira: deshabilita ambos botones con el motivo a la vista y deja que el
 * backend sea la verdad al decidir. (Rechazar nunca da acceso y el backend no lo bloquea por auto-solicitud;
 * se deshabilita igual para que la fila hable con una sola voz. Quien pidió cancela desde la
 * sección de la persona, que es su lugar.)
 *
 * Una carrera (otra persona decidió, venció o se canceló) responde 404/409: el diálogo se queda
 * abierto con el motivo y la confirmación deshabilitada, y los hooks ya refrescan la bandeja, así
 * que la fila desaparece sola.
 */
export function PendingCapabilityGrantsCard() {
  const ids = useId()
  const headingId = `${ids}-titulo`
  const reasonId = `${ids}-motivo`

  const pending = usePendingCapabilityGrants()
  const catalog = useCapabilityCatalog().data
  const approve = useApproveCapabilityGrant()
  const reject = useRejectCapabilityGrant()

  const [decision, setDecision] = useState<Decision | null>(null)
  const [reason, setReason] = useState('')

  const capabilityName = useCallback(
    (id: string) => catalog?.find((row) => row.id === id)?.label ?? id,
    [catalog],
  )

  const mutation = decision?.kind === 'reject' ? reject : approve
  const stale = mutation.isError && [404, 409].includes(toApiError(mutation.error).status ?? 0)
  const dialogError = (() => {
    if (!mutation.isError) return null
    if (isAccessForbidden(mutation.error)) return forbiddenCopy().body
    const apiError = toApiError(mutation.error)
    return capabilityGrantErrorMessage(apiError, { decision: true }) ?? apiError.message
  })()

  const { reset: resetApprove } = approve
  const { reset: resetReject } = reject
  const open = useCallback(
    (next: Decision) => {
      resetApprove()
      resetReject()
      setReason('')
      setDecision(next)
    },
    [resetApprove, resetReject],
  )
  const close = () => {
    setDecision(null)
    setReason('')
    approve.reset()
    reject.reset()
  }
  const confirm = () => {
    if (!decision) return
    mutation.mutate({ grantId: decision.grant.id, reason }, { onSuccess: close })
  }

  const columns = useMemo<ColumnDef<PendingCapabilityGrant>[]>(
    () => [
      {
        id: 'grantee',
        header: 'Persona',
        cell: ({ row }) => (
          <span className="font-mono font-medium text-foreground">
            {row.original.username ?? `#${row.original.user_id}`}
          </span>
        ),
      },
      {
        id: 'capability',
        header: 'Capacidad',
        cell: ({ row }) => {
          const grant = row.original
          return (
            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">
                {capabilityName(grant.capability)}
              </span>
              <code className="font-mono text-[11px] text-muted-foreground">
                {grant.capability}
              </code>
              {grant.implies.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Incluye la lectura: {grant.implies.map(capabilityName).join(', ')}.
                </span>
              )}
            </div>
          )
        },
      },
      {
        id: 'scope',
        header: 'Alcance',
        cell: ({ row }) => scopeLabel(row.original),
      },
      {
        id: 'requested',
        header: 'Pedida',
        cell: ({ row }) => {
          const grant = row.original
          return (
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <span className="text-sm text-foreground">{grant.requested_by?.username ?? '—'}</span>
              {grant.requested_at && <span>{formatDateTime(grant.requested_at)}</span>}
              {grant.request_reason && <span>Motivo: {grant.request_reason}</span>}
            </div>
          )
        },
      },
      {
        id: 'expires',
        header: 'Vence',
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.expires_at ? formatDateTime(row.original.expires_at) : '—'}
          </span>
        ),
      },
      {
        // `header: ''` = columna de acciones: en la vista de tarjetas va al final, sin etiqueta.
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const grant = row.original
          const blocked = grant.can_decide
            ? null
            : (capabilityGrantBlockedMessage(grant.blocked_reason) ??
              capabilityGrantBlockedMessage('unknown'))
          const blockedId = `${ids}-bloqueo-${grant.id}`
          const subject = `${capabilityName(grant.capability)} de ${grant.username ?? grant.user_id} en ${scopeLabel(grant)}`
          return (
            <div className="flex flex-col items-start gap-2">
              {/* Acciones de dominio: conservan el texto. El nombre accesible dice QUÉ y de QUIÉN
                  porque hay un par de botones por fila. */}
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!grant.can_decide}
                  aria-describedby={blocked ? blockedId : undefined}
                  aria-label={`Aprobar: ${subject}`}
                  onClick={() => open({ kind: 'approve', grant })}
                >
                  Aprobar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!grant.can_decide}
                  aria-describedby={blocked ? blockedId : undefined}
                  aria-label={`Rechazar: ${subject}`}
                  onClick={() => open({ kind: 'reject', grant })}
                >
                  Rechazar
                </Button>
              </div>
              {blocked && (
                <p id={blockedId} className="max-w-xs text-xs text-muted-foreground">
                  {blocked}
                </p>
              )}
            </div>
          )
        },
      },
    ],
    [capabilityName, ids, open],
  )

  const approving = decision?.kind === 'approve'

  return (
    <Card>
      <section aria-labelledby={headingId}>
        <CardHeader>
          <h2 id={headingId} className="text-base font-semibold text-foreground">
            Capacidades puntuales
          </h2>
          <p className="text-sm text-muted-foreground">
            Capacidades sensibles (las exclusivas de owner) o con excepción de emergencia que pidió
            una persona con access_admin. No rigen hasta que las apruebe otra persona con
            access_admin distinta de quien las pidió; si nadie las decide, vencen a los 7 días.
          </p>
        </CardHeader>
        <CardContent>
          {isAccessForbidden(pending.error) ? (
            <ForbiddenState title="No tenés acceso a las solicitudes pendientes" />
          ) : pending.isError ? (
            <ErrorState
              error={pending.error}
              message={capabilityGrantErrorMessage(toApiError(pending.error)) ?? undefined}
              onRetry={() => void pending.refetch()}
            />
          ) : (
            <DataTable<PendingCapabilityGrant>
              data={pending.data ?? []}
              columns={columns}
              isLoading={pending.isLoading}
              isFetching={pending.isFetching}
              enableGlobalFilter={false}
              getRowId={(grant) => String(grant.id)}
              emptyState={
                <EmptyState
                  title="No hay capacidades puntuales pendientes"
                  description="Cuando alguien pida una capacidad sensible para otra persona, aparece acá para que la decida un segundo administrador de accesos."
                />
              }
            />
          )}
        </CardContent>
      </section>

      {decision && (
        <ConfirmDialog
          open
          onClose={close}
          onConfirm={confirm}
          title={approving ? '¿Aprobar esta capacidad?' : '¿Rechazar esta solicitud?'}
          description={
            approving
              ? `${decision.grant.username ?? 'La persona'} pasa a tener «${capabilityName(decision.grant.capability)}» en ${scopeLabel(decision.grant)}, al instante. Pidió ${decision.grant.requested_by?.username ?? 'otra persona'}.`
              : `La solicitud de «${capabilityName(decision.grant.capability)}» para ${decision.grant.username ?? 'la persona'} en ${scopeLabel(decision.grant)} se cierra y no llega a concederse. Se puede volver a pedir.`
          }
          confirmLabel={approving ? 'Aprobar capacidad' : 'Rechazar solicitud'}
          tone={approving ? 'primary' : 'danger'}
          isLoading={mutation.isPending}
          confirmDisabled={stale}
          confirmDescribedBy={stale ? `${reasonId}-error` : undefined}
        >
          <Textarea
            label="Motivo"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={REASON_MAX}
            hint={`Opcional, queda en el historial. ${reason.length}/${REASON_MAX}`}
            className="min-h-16"
          />
          {/* `role="alert"`: el error llega después de apretar y tiene que anunciarse. */}
          {dialogError && (
            <p id={`${reasonId}-error`} role="alert" className="text-sm text-error">
              {dialogError}
            </p>
          )}
        </ConfirmDialog>
      )}
    </Card>
  )
}
