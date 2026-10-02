import { useCallback, useId, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
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
  globalCapabilityLabel,
  isAccessForbidden,
  useSession,
} from '@/features/auth'
import { useEnvironmentMap } from '@/features/environments'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { toApiError } from '@/lib/api/errors'
import { isKnownGlobalCapability, type PendingAccessRequest } from '@/lib/contracts'
import { formatDateTime } from '@/lib/utils/format'
import { accessRequestDiff, type AccessDiffRow } from '../access-request-diff'
import {
  useApproveAccessRequest,
  useCancelAccessRequest,
  usePendingAccessRequests,
  useRejectAccessRequest,
} from '../hooks/use-access-requests'
import { useGatewayUser } from '../hooks/use-gateway-users'
import { accessRequestBlockedMessage, accessRequestErrorMessage } from '../messages'
import { SecondApproverBadge } from './SecondApproverBadge'

/** Largo máximo del motivo: el mismo tope que el contrato y el backend. */
const REASON_MAX = 500

/** De qué pantalla salió el pedido. Un `origin` nuevo del backend se muestra tal cual. */
const ORIGIN_LABELS: Record<string, string> = {
  create: 'Alta de la cuenta',
  update: 'Edición del usuario',
  set_access: 'Cambio de accesos',
}

type DecisionKind = 'approve' | 'reject' | 'cancel'
type Decision = { kind: DecisionKind; request: PendingAccessRequest }

type ScopeLabel = (scopeType: string, scopeId: number) => string

/** «Entorno Producción» / «Servidor db-prod-01»; sin nombre cargado, el id. */
function useScopeLabel(): ScopeLabel {
  const environments = useEnvironmentMap().byId
  const servers = useServerOptions().data
  return useCallback(
    (scopeType: string, scopeId: number) => {
      if (scopeType === 'environment') {
        return `Entorno ${environments.get(scopeId)?.name ?? `#${scopeId}`}`
      }
      if (scopeType === 'server') {
        return `Servidor ${servers?.find((server) => server.id === scopeId)?.name ?? `#${scopeId}`}`
      }
      return `${scopeType} #${scopeId}`
    },
    [environments, servers],
  )
}

/** Una global por su nombre legible, con el id al lado para quien la busca en la auditoría. */
function globalName(id: string): string {
  return isKnownGlobalCapability(id) ? `${globalCapabilityLabel(id)} (${id})` : id
}

function describeValue(row: AccessDiffRow, value: string | null | undefined): string {
  if (value === undefined) return '?'
  if (row.kind === 'global_capability') return value ? 'la tiene' : 'no la tiene'
  if (row.kind === 'scope_grant') return value ?? 'sin permiso'
  return value ?? '—'
}

/**
 * El cambio de una solicitud, compacto: una línea por cosa que cambia («Rol base: viewer → owner»),
 * con el distintivo en lo que eleva. Compara contra el acceso ACTUAL de la persona
 * (`GET /gateway-users/{id}`): `desired` es el estado final, no un delta.
 */
function AccessRequestChange({
  request,
  scopeLabel,
}: {
  request: PendingAccessRequest
  scopeLabel: ScopeLabel
}) {
  const current = useGatewayUser(request.target.id)
  const diff = accessRequestDiff(request, current.data, scopeLabel)
  return (
    <div className="flex flex-col gap-1">
      {diff.rows.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          No hay diferencia con el acceso actual.
        </span>
      ) : (
        <ul className="flex flex-col gap-1">
          {diff.rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="text-foreground">
                {row.kind === 'global_capability' ? globalName(row.subject) : row.subject}:
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {describeValue(row, row.before)} → {describeValue(row, row.after)}
              </span>
              {row.elevated && <SecondApproverBadge bootstrapNote={false} />}
            </li>
          ))}
        </ul>
      )}
      {request.sod_override && (
        <span className="text-xs text-muted-foreground">
          Incluye una excepción de emergencia de separación de funciones
          {request.sod_override.expires_in_hours
            ? ` por ${request.sod_override.expires_in_hours} h`
            : ''}
          : {request.sod_override.reason}
        </span>
      )}
      {diff.drift && (
        <span className="text-xs text-warning">
          El acceso de la persona cambió desde el pedido: aprobarla probablemente la cancele por
          vieja.
        </span>
      )}
    </div>
  )
}

const DIALOG_COPY: Record<
  DecisionKind,
  { title: string; confirm: string; tone: 'primary' | 'danger' }
> = {
  approve: { title: '¿Aprobar esta elevación?', confirm: 'Aprobar elevación', tone: 'primary' },
  reject: { title: '¿Rechazar esta elevación?', confirm: 'Rechazar elevación', tone: 'danger' },
  cancel: { title: '¿Cancelar tu solicitud?', confirm: 'Cancelar solicitud', tone: 'danger' },
}

interface PendingAccessRequestsCardProps {
  /** Solicitud a destacar (la que se acaba de pedir, `?solicitud=`). */
  focusId?: number | null
}

/**
 * Bandeja de ELEVACIONES de acceso que esperan un segundo aprobador (api-reference-v29 §9.4):
 * `owner` base o por alcance, globales agregadas y `sod_override` que nacieron de un alta, una
 * edición o un cambio de accesos. Solo la monta quien tiene `access.admin`.
 *
 * Mismo contrato de UI que `PendingCapabilityGrantsCard`: **`can_decide` y `blocked_reason` son del
 * servidor** y la UI no los recalcula; con `false`, Aprobar y Rechazar van deshabilitados con el
 * motivo visible (`aria-describedby`). Lo único que se decide en el cliente es si ofrecer
 * «Cancelar»: lo puede hacer solo quien la pidió (el servidor lo confirma con 409
 * `access.request_not_requester`), y no pide step-up.
 *
 * Una carrera (otra persona decidió, venció, quedó vieja) responde 404/409: el diálogo se queda
 * abierto con el motivo y la confirmación deshabilitada, y los hooks refrescan la bandeja.
 */
export function PendingAccessRequestsCard({ focusId = null }: PendingAccessRequestsCardProps) {
  const ids = useId()
  const headingId = `${ids}-titulo`
  const reasonId = `${ids}-motivo`

  const { admin } = useSession()
  const sessionUserId = admin?.id ?? null
  const pending = usePendingAccessRequests()
  const approve = useApproveAccessRequest()
  const reject = useRejectAccessRequest()
  const cancel = useCancelAccessRequest()
  const scopeLabel = useScopeLabel()

  const [decision, setDecision] = useState<Decision | null>(null)
  const [reason, setReason] = useState('')

  const mutation =
    decision?.kind === 'reject' ? reject : decision?.kind === 'cancel' ? cancel : approve
  const stale = mutation.isError && [404, 409].includes(toApiError(mutation.error).status ?? 0)
  const dialogError = (() => {
    if (!mutation.isError) return null
    if (isAccessForbidden(mutation.error)) return forbiddenCopy().body
    const apiError = toApiError(mutation.error)
    return accessRequestErrorMessage(apiError) ?? apiError.message
  })()

  const { reset: resetApprove } = approve
  const { reset: resetReject } = reject
  const { reset: resetCancel } = cancel
  const resetAll = useCallback(() => {
    resetApprove()
    resetReject()
    resetCancel()
  }, [resetApprove, resetReject, resetCancel])
  const open = useCallback(
    (next: Decision) => {
      resetAll()
      setReason('')
      setDecision(next)
    },
    [resetAll],
  )
  const close = () => {
    setDecision(null)
    setReason('')
    resetAll()
  }
  const confirm = () => {
    if (!decision) return
    mutation.mutate({ requestId: decision.request.id, reason }, { onSuccess: close })
  }

  const columns = useMemo<ColumnDef<PendingAccessRequest>[]>(
    () => [
      {
        id: 'target',
        header: 'Persona',
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <span className="font-mono font-medium text-foreground">
              {row.original.target.username}
            </span>
            {row.original.id === focusId && <Badge tone="info">Recién pedida</Badge>}
          </div>
        ),
      },
      {
        id: 'change',
        header: 'Cambio',
        cell: ({ row }) => <AccessRequestChange request={row.original} scopeLabel={scopeLabel} />,
      },
      {
        id: 'requested',
        header: 'Pedida',
        cell: ({ row }) => {
          const request = row.original
          return (
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <span className="text-sm text-foreground">
                {request.requested_by?.username ?? '—'}
              </span>
              {request.origin && <span>{ORIGIN_LABELS[request.origin] ?? request.origin}</span>}
              {request.created_at && <span>{formatDateTime(request.created_at)}</span>}
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
          const request = row.original
          const blocked = request.can_decide
            ? null
            : (accessRequestBlockedMessage(request.blocked_reason) ??
              accessRequestBlockedMessage('unknown'))
          const blockedId = `${ids}-bloqueo-${request.id}`
          const own = sessionUserId !== null && request.requested_by?.id === sessionUserId
          const subject = `elevación de ${request.target.username}`
          return (
            <div className="flex flex-col items-start gap-2">
              {/* Acciones de dominio: conservan el texto. El nombre accesible dice de QUIÉN porque
                  hay varios botones por fila. */}
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!request.can_decide}
                  aria-describedby={blocked ? blockedId : undefined}
                  aria-label={`Aprobar: ${subject}`}
                  onClick={() => open({ kind: 'approve', request })}
                >
                  Aprobar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!request.can_decide}
                  aria-describedby={blocked ? blockedId : undefined}
                  aria-label={`Rechazar: ${subject}`}
                  onClick={() => open({ kind: 'reject', request })}
                >
                  Rechazar
                </Button>
                {own && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Cancelar: ${subject}`}
                    onClick={() => open({ kind: 'cancel', request })}
                  >
                    Cancelar
                  </Button>
                )}
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
    [focusId, ids, open, scopeLabel, sessionUserId],
  )

  const dialogDescription = (current: Decision): string => {
    const who = current.request.target.username
    const by = current.request.requested_by?.username ?? 'otra persona'
    switch (current.kind) {
      case 'approve':
        return `${who} pasa a tener el acceso pedido al instante, y se cierran sus sesiones. Pidió ${by}.`
      case 'reject':
        return `La elevación para ${who} se cierra y no se aplica. Lo que no requería aprobación ya rige y se mantiene.`
      case 'cancel':
        return `Retirás la elevación que pediste para ${who}. Lo que no requería aprobación ya rige y se mantiene.`
    }
  }

  return (
    <Card>
      <section aria-labelledby={headingId}>
        <CardHeader>
          <h2 id={headingId} className="text-base font-semibold text-foreground">
            Elevaciones de acceso
          </h2>
          <p className="text-sm text-muted-foreground">
            Roles owner y capacidades globales que pidió una persona con access_admin. Lo que no
            eleva ya se aplicó; esto no rige hasta que lo apruebe otra persona con access_admin
            distinta de quien lo pidió. Si nadie lo decide, vence a los 7 días.
          </p>
        </CardHeader>
        <CardContent>
          {isAccessForbidden(pending.error) ? (
            <ForbiddenState title="No tenés acceso a las elevaciones pendientes" />
          ) : pending.isError ? (
            <ErrorState
              error={pending.error}
              message={accessRequestErrorMessage(toApiError(pending.error)) ?? undefined}
              onRetry={() => void pending.refetch()}
            />
          ) : (
            <DataTable<PendingAccessRequest>
              data={pending.data ?? []}
              columns={columns}
              isLoading={pending.isLoading}
              isFetching={pending.isFetching}
              enableGlobalFilter={false}
              getRowId={(request) => String(request.id)}
              emptyState={
                <EmptyState
                  title="No hay elevaciones pendientes"
                  description="Cuando alguien dé owner o una capacidad global a otra persona, aparece acá para que la decida un segundo administrador de accesos."
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
          title={DIALOG_COPY[decision.kind].title}
          description={dialogDescription(decision)}
          confirmLabel={DIALOG_COPY[decision.kind].confirm}
          tone={DIALOG_COPY[decision.kind].tone}
          isLoading={mutation.isPending}
          confirmDisabled={stale}
          confirmDescribedBy={stale ? `${reasonId}-error` : undefined}
        >
          <AccessRequestChange request={decision.request} scopeLabel={scopeLabel} />
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
