import { useCallback, useId, useMemo, useState, type FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Combobox,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Textarea,
  type BadgeTone,
} from '@/components/ui'
import {
  ForbiddenState,
  forbiddenCopy,
  groupByModule,
  isAccessForbidden,
  moduleLabel,
} from '@/features/auth'
import { useSelectableEnvironments } from '@/features/environments'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { toApiError } from '@/lib/api/errors'
import {
  CAPABILITY_GRANT_ERROR_CODES,
  SCOPE_TYPES,
  type CapabilityDescriptor,
  type CapabilityGrant,
  type GatewayUserOut,
  type ScopeType,
} from '@/lib/contracts'
import { formatDateTime } from '@/lib/utils/format'
import {
  useCapabilityGrants,
  useCreateCapabilityGrant,
  useRevokeCapabilityGrant,
} from '../hooks/use-capability-grants'
import { capabilityGrantBlockedMessage, capabilityGrantErrorMessage } from '../messages'

/** Largo máximo del motivo: el mismo tope que el contrato y el backend. */
const REASON_MAX = 500

const SCOPE_TYPE_LABELS: Record<ScopeType, string> = {
  environment: 'Entorno',
  server: 'Servidor',
}

interface ScopeTypeOption {
  value: ScopeType
  label: string
}
const SCOPE_TYPE_OPTIONS: ScopeTypeOption[] = SCOPE_TYPES.map((value) => ({
  value,
  label: SCOPE_TYPE_LABELS[value],
}))

interface TargetOption {
  id: number
  label: string
}

/** Estado → etiqueta y tono. Un estado que esta versión no conoce se muestra tal cual, en neutro. */
const STATUS_BADGES: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: 'Activa', tone: 'success' },
  pending: { label: 'Pendiente de aprobación', tone: 'warning' },
  rejected: { label: 'Rechazada', tone: 'error' },
  expired: { label: 'Vencida', tone: 'neutral' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
  revoked: { label: 'Revocada', tone: 'neutral' },
}

/** «Viva» = rige o está esperando decisión; el resto es historial. */
function isLive(grant: CapabilityGrant): boolean {
  return grant.status === 'active' || grant.status === 'pending'
}

/** «Entorno · Producción»; si el destino ya no existe el backend manda `null` y va el id. */
function scopeLabel(grant: Pick<CapabilityGrant, 'scope_type' | 'scope_id' | 'scope_name'>) {
  const type = SCOPE_TYPE_LABELS[grant.scope_type as ScopeType] ?? grant.scope_type
  return `${type} · ${grant.scope_name ?? `#${grant.scope_id}`}`
}

interface CapabilityGrantsSectionProps {
  /** Persona a la que se otorga (no quien tiene la sesión). */
  user: Pick<GatewayUserOut, 'id' | 'username' | 'is_active'>
  /** `true` si `user` es la cuenta con la sesión abierta: nadie se otorga ni se revoca a sí mismo. */
  isSelf: boolean
  /** Catálogo de `GET /authz/catalog`; de ahí salen las etiquetas y qué se puede otorgar. */
  catalog: readonly CapabilityDescriptor[] | undefined
  isCatalogLoading: boolean
}

/**
 * «Capacidades puntuales» de la pantalla de accesos: otorgar UNA capacidad sobre UN entorno o
 * servidor sin tocar el rol (api-reference §19), y ver, revocar o cancelar las que ya hay.
 *
 * **Se monta solo para `access_admin`**: el listado es de ese rol y pedirlo con otro sería un 403
 * seguro. Quien monta esto decide; acá no se vuelve a preguntar, así que las consultas se disparan
 * apenas se monta.
 *
 * **Es inmediato, no pasa por «Guardar accesos».** `PUT /access` no toca las capacidades puntuales
 * (las conserva), y estas tienen sus propios endpoints: el texto de la cabecera lo dice porque, en
 * una página cuya barra inferior guarda «el estado completo», lo contrario es lo que se asumiría.
 *
 * Una capacidad sensible no se concede al crearla: queda `pending` hasta que OTRA persona con
 * `access_admin` la apruebe (bandeja, F4). La UI lo dice antes de enviar y después de enviar,
 * porque «Capacidad otorgada» sobre algo que todavía no rige sería mentir.
 */
export function CapabilityGrantsSection({
  user,
  isSelf,
  catalog,
  isCatalogLoading,
}: CapabilityGrantsSectionProps) {
  const ids = useId()
  const headingId = `${ids}-titulo`
  const formHeadingId = `${ids}-form`
  const blockedId = `${ids}-bloqueo`
  const duplicateId = `${ids}-duplicada`
  const errorId = `${ids}-error`
  const detailId = `${ids}-detalle`

  const [showHistory, setShowHistory] = useState(false)
  const [capabilityId, setCapabilityId] = useState<string | null>(null)
  const [scopeType, setScopeType] = useState<ScopeType>('environment')
  const [scopeId, setScopeId] = useState(0)
  const [reason, setReason] = useState('')
  const [toRevoke, setToRevoke] = useState<CapabilityGrant | null>(null)

  const grantsQuery = useCapabilityGrants(user.id)
  const create = useCreateCapabilityGrant(user.id)
  const revoke = useRevokeCapabilityGrant(user.id)
  const environments = useSelectableEnvironments()
  const servers = useServerOptions()

  const grants = grantsQuery.data
  const live = useMemo(() => (grants ?? []).filter(isLive), [grants])
  const visible = showHistory ? (grants ?? []) : live
  const historyCount = (grants ?? []).length - live.length

  /** Solo lo otorgable, agrupado por módulo en el orden del catálogo. Sin catálogo, nada. */
  const grantable = useMemo(
    () =>
      groupByModule((catalog ?? []).filter((row) => row.grantable)).flatMap((group) => group.rows),
    [catalog],
  )
  const capabilityName = useCallback(
    (id: string) => catalog?.find((row) => row.id === id)?.label ?? id,
    [catalog],
  )

  const selected = capabilityId ? (grantable.find((row) => row.id === capabilityId) ?? null) : null
  const targets: TargetOption[] =
    scopeType === 'environment'
      ? environments.selectable.map((env) => ({ id: env.id, label: env.name }))
      : (servers.data ?? []).map((server) => ({ id: server.id, label: server.name }))
  const target = targets.find((option) => option.id === scopeId) ?? null

  // Los dos bloqueos son del DESTINO de la operación y el backend los rechaza antes que cualquier
  // otro chequeo: se explican acá, con el copy de siempre, en vez de dejar llegar a un 409.
  const blockedReason = isSelf
    ? capabilityGrantBlockedMessage(CAPABILITY_GRANT_ERROR_CODES.selfModificationForbidden)
    : !user.is_active
      ? capabilityGrantBlockedMessage(CAPABILITY_GRANT_ERROR_CODES.grantUserInactive)
      : null

  // Pista del lado del cliente con la lista que ya está en pantalla; el `UNIQUE` del backend sigue
  // siendo la verdad (409 `access.grant_duplicate`).
  const duplicate =
    capabilityId && scopeId >= 1
      ? live.find(
          (grant) =>
            grant.capability === capabilityId &&
            grant.scope_type === scopeType &&
            grant.scope_id === scopeId,
        )
      : undefined

  const canSubmit =
    selected !== null &&
    scopeId >= 1 &&
    blockedReason === null &&
    duplicate === undefined &&
    reason.length <= REASON_MAX

  // Un cambio de cualquier campo descarta el resultado o el error anterior: ya no hablan de lo que
  // hay en el formulario.
  const touch = () => {
    if (!create.isIdle) create.reset()
  }

  const formError = (() => {
    if (!create.isError) return null
    // El 403 usa el copy compartido (el toast ya dice lo mismo): el aviso del formulario queda
    // legible aunque el toast se haya cerrado.
    if (isAccessForbidden(create.error)) return forbiddenCopy().body
    const apiError = toApiError(create.error)
    return capabilityGrantErrorMessage(apiError) ?? apiError.message
  })()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit || !selected) return
    const trimmed = reason.trim()
    create.mutate(
      {
        capability: selected.id,
        scope_type: scopeType,
        scope_id: scopeId,
        ...(trimmed ? { reason: trimmed } : {}),
      },
      {
        onSuccess: () => {
          // Se limpia lo que se eligió pero se deja el tipo de destino: otorgar varias seguidas
          // sobre el mismo tipo es lo habitual.
          setCapabilityId(null)
          setScopeId(0)
          setReason('')
        },
      },
    )
  }

  const columns = useMemo<ColumnDef<CapabilityGrant>[]>(
    () => [
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
              {grant.sensitive && (
                <span className="self-start">
                  <Badge tone="warning">Sensible</Badge>
                </span>
              )}
              {grant.implies.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Incluye la lectura: {grant.implies.map(capabilityName).join(', ')}.
                </span>
              )}
              {grant.request_reason && (
                <span className="text-xs text-muted-foreground">
                  Motivo: {grant.request_reason}
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
        id: 'status',
        header: 'Estado',
        cell: ({ row }) => {
          const grant = row.original
          const badge = STATUS_BADGES[grant.status] ?? { label: grant.status, tone: 'neutral' }
          return (
            <div className="flex flex-col items-start gap-1">
              <Badge tone={badge.tone}>{badge.label}</Badge>
              {grant.status === 'pending' && (
                <span className="text-xs text-muted-foreground">
                  Todavía no concede acceso: la decide otra persona con access_admin
                  {grant.expires_at ? `. Vence el ${formatDateTime(grant.expires_at)}` : ''}.
                </span>
              )}
              {!isLive(grant) && grant.decided_by && (
                <span className="text-xs text-muted-foreground">
                  {grant.decided_by.username}
                  {grant.decided_at ? ` · ${formatDateTime(grant.decided_at)}` : ''}
                </span>
              )}
              {!isLive(grant) && grant.decision_reason && (
                <span className="text-xs text-muted-foreground">
                  Motivo: {grant.decision_reason}
                </span>
              )}
            </div>
          )
        },
      },
      {
        id: 'requested',
        header: 'Pedida',
        cell: ({ row }) => {
          const grant = row.original
          return (
            <div className="flex flex-col text-xs text-muted-foreground">
              <span className="text-sm text-foreground">{grant.requested_by?.username ?? '—'}</span>
              <span>{formatDateTime(grant.requested_at)}</span>
            </div>
          )
        },
      },
      {
        // `header: ''` = columna de acciones: en la vista de tarjetas va al final, sin etiqueta.
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const grant = row.original
          if (!isLive(grant)) return null
          const cancel = grant.status === 'pending'
          const verb = cancel ? 'Cancelar solicitud' : 'Revocar'
          return (
            // Acción de dominio: conserva el texto. El nombre accesible dice QUÉ y DÓNDE porque
            // hay un botón igual por fila.
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSelf}
              aria-describedby={isSelf ? blockedId : undefined}
              aria-label={`${verb}: ${capabilityName(grant.capability)} en ${scopeLabel(grant)}`}
              onClick={() => setToRevoke(grant)}
            >
              {verb}
            </Button>
          )
        },
      },
    ],
    [capabilityName, isSelf, blockedId],
  )

  const confirmCancel = toRevoke?.status === 'pending'

  return (
    <Card>
      <section aria-labelledby={headingId}>
        <CardHeader>
          <h2 id={headingId} className="text-base font-semibold text-foreground">
            Capacidades puntuales
          </h2>
          <p className="text-sm text-muted-foreground">
            Suman UNA capacidad sobre UN entorno o servidor sin cambiar el rol de {user.username}.
            Se aplican al instante, sin pasar por «Guardar accesos», y esa pantalla no las toca.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {blockedReason && (
            <p
              id={blockedId}
              className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground"
            >
              {blockedReason}
            </p>
          )}

          {/* ── Otorgar ─────────────────────────────────────────────────────── */}
          <form
            onSubmit={submit}
            aria-labelledby={formHeadingId}
            noValidate
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
          >
            <h3 id={formHeadingId} className="text-sm font-semibold text-foreground">
              Otorgar una capacidad
            </h3>

            <Combobox<CapabilityDescriptor>
              items={grantable}
              value={selected}
              onChange={(row) => {
                touch()
                setCapabilityId(row?.id ?? null)
              }}
              itemToString={(row) => row.label}
              itemToKey={(row) => row.id}
              renderItem={(row) => (
                <span className="flex flex-col">
                  <span>{row.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    <code className="font-mono">{row.id}</code> · {moduleLabel(row.module)}
                    {row.sensitive ? ' · Requiere aprobación de otro admin' : ''}
                  </span>
                </span>
              )}
              label="Capacidad"
              placeholder="Elegí una capacidad"
              disabled={blockedReason !== null}
              isLoading={isCatalogLoading}
              hint={
                !isCatalogLoading && grantable.length === 0
                  ? 'No hay capacidades para otorgar de forma puntual: el catálogo no publicó ninguna.'
                  : undefined
              }
            />

            {selected && (
              <div id={detailId} className="flex flex-col gap-1 text-xs text-muted-foreground">
                <code className="font-mono">{selected.id}</code>
                {selected.implies.length > 0 && (
                  <span>
                    Incluye la lectura: {selected.implies.map(capabilityName).join(', ')}.
                  </span>
                )}
                {selected.sensitive && (
                  <span className="font-medium text-foreground">
                    Requiere aprobación de otro admin: queda pendiente y no concede acceso hasta que
                    otra persona con access_admin la apruebe.
                  </span>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <Combobox<ScopeTypeOption>
                items={SCOPE_TYPE_OPTIONS}
                value={SCOPE_TYPE_OPTIONS.find((option) => option.value === scopeType) ?? null}
                onChange={(option) => {
                  if (!option) return
                  touch()
                  // Un id de entorno no significa nada como id de servidor: se obliga a re-elegir.
                  setScopeType(option.value)
                  setScopeId(0)
                }}
                itemToString={(option) => option.label}
                itemToKey={(option) => option.value}
                label="Tipo de destino"
                disabled={blockedReason !== null}
              />
              <Combobox<TargetOption>
                items={targets}
                value={target}
                onChange={(option) => {
                  touch()
                  setScopeId(option?.id ?? 0)
                }}
                itemToString={(option) => option.label}
                itemToKey={(option) => option.id}
                label={`${SCOPE_TYPE_LABELS[scopeType]} de destino`}
                placeholder="Elegí un destino"
                disabled={blockedReason !== null}
                isLoading={scopeType === 'environment' ? environments.isPending : servers.isPending}
              />
            </div>

            <Textarea
              label="Motivo"
              value={reason}
              onChange={(event) => {
                touch()
                setReason(event.target.value)
              }}
              maxLength={REASON_MAX}
              hint={`Opcional, queda en el historial. ${reason.length}/${REASON_MAX}`}
              disabled={blockedReason !== null}
              className="min-h-16"
            />

            {duplicate && (
              <p id={duplicateId} role="status" className="text-sm text-warning">
                {capabilityGrantBlockedMessage(CAPABILITY_GRANT_ERROR_CODES.grantDuplicate)}
              </p>
            )}

            {/* `role="alert"`: el error llega después de apretar y tiene que anunciarse. Va junto
                al botón, no solo en el toast, que se cierra solo. */}
            {formError && (
              <p id={errorId} role="alert" className="text-sm text-error">
                {formError}
              </p>
            )}

            {create.isSuccess && (
              <p role="status" className="text-sm text-foreground">
                {create.data.status === 'pending' ? (
                  <>
                    <strong>Solicitud enviada, todavía no concede acceso.</strong>{' '}
                    {capabilityName(create.data.capability)} en {scopeLabel(create.data)} queda
                    pendiente hasta que otra persona con access_admin la apruebe.
                  </>
                ) : (
                  <>
                    <strong>Capacidad otorgada.</strong> {capabilityName(create.data.capability)} en{' '}
                    {scopeLabel(create.data)} ya rige.
                  </>
                )}
              </p>
            )}

            <div>
              <Button
                type="submit"
                size="sm"
                disabled={!canSubmit}
                isLoading={create.isPending}
                aria-describedby={blockedReason ? blockedId : duplicate ? duplicateId : undefined}
              >
                Otorgar capacidad
              </Button>
            </div>
          </form>

          {/* ── Lista ───────────────────────────────────────────────────────── */}
          {isAccessForbidden(grantsQuery.error) ? (
            <ForbiddenState title="No tenés acceso a las capacidades puntuales" />
          ) : grantsQuery.isError ? (
            <ErrorState
              error={grantsQuery.error}
              message={capabilityGrantErrorMessage(toApiError(grantsQuery.error)) ?? undefined}
              onRetry={() => void grantsQuery.refetch()}
            />
          ) : (
            <DataTable<CapabilityGrant>
              data={visible}
              columns={columns}
              isLoading={grantsQuery.isLoading}
              enableGlobalFilter={false}
              getRowId={(grant) => String(grant.id)}
              toolbar={
                <Checkbox
                  label="Ver también el historial"
                  hint={
                    historyCount > 0
                      ? `${historyCount} rechazada${historyCount === 1 ? '' : 's'}, vencida${historyCount === 1 ? '' : 's'}, cancelada${historyCount === 1 ? '' : 's'} o revocada${historyCount === 1 ? '' : 's'}.`
                      : 'Rechazadas, vencidas, canceladas y revocadas.'
                  }
                  checked={showHistory}
                  onChange={(event) => setShowHistory(event.target.checked)}
                />
              }
              emptyState={
                <p className="text-center text-sm text-muted-foreground">
                  {showHistory
                    ? `${user.username} no tiene capacidades puntuales ni historial.`
                    : `${user.username} no tiene capacidades puntuales vigentes.`}
                </p>
              }
            />
          )}
        </CardContent>
      </section>

      {toRevoke && (
        <ConfirmDialog
          open
          onClose={() => setToRevoke(null)}
          onConfirm={() =>
            revoke.mutate(toRevoke.id, {
              // Se cierra con éxito o con error: el toast y el refresco de la lista (404/409) dicen
              // qué pasó, y un diálogo abierto sobre una fila que ya no existe no ofrece nada.
              onSettled: () => setToRevoke(null),
            })
          }
          title={confirmCancel ? '¿Cancelar esta solicitud?' : '¿Revocar esta capacidad?'}
          description={
            confirmCancel
              ? `La solicitud de «${capabilityName(toRevoke.capability)}» en ${scopeLabel(toRevoke)} se cancela y no llega a concederse. Se puede volver a pedir.`
              : `${user.username} deja de tener «${capabilityName(toRevoke.capability)}» en ${scopeLabel(toRevoke)} por esta vía, al instante. Si su rol ya la incluye, la conserva.`
          }
          confirmLabel={confirmCancel ? 'Cancelar solicitud' : 'Revocar capacidad'}
          tone="danger"
          isLoading={revoke.isPending}
        />
      )}
    </Card>
  )
}
