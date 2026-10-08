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
  MultiCombobox,
  Textarea,
  type BadgeTone,
} from '@/components/ui'
import {
  ForbiddenState,
  forbiddenCopy,
  groupByModule,
  isAccessForbidden,
  moduleLabel,
  type SodConflict,
} from '@/features/auth'
import { useSelectableEnvironments } from '@/features/environments'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { toApiError, type ApiGrantBulkFailure } from '@/lib/api/errors'
import {
  CAPABILITY_GRANT_BULK_MAX,
  CAPABILITY_GRANT_ERROR_CODES,
  SCOPE_TYPES,
  type CapabilityDescriptor,
  type CapabilityGrant,
  type CapabilityGrantBulkCreate,
  type GatewayUserOut,
  type ScopeType,
  type SodOverrideIn,
} from '@/lib/contracts'
import { formatDateTime } from '@/lib/utils/format'
import {
  useCapabilityGrants,
  useCreateCapabilityGrantsBulk,
  useRevokeCapabilityGrant,
} from '../hooks/use-capability-grants'
import { isSensitiveCapability } from '../assignment-policy'
import { capabilityGrantBlockedMessage, capabilityGrantErrorMessage } from '../messages'
import { SecondApproverBadge } from './SecondApproverBadge'
import { SodConflictPanel } from './SodConflictPanel'

/** Largo máximo del motivo: el mismo tope que el contrato y el backend. */
const REASON_MAX = 500

/**
 * Un destino del alta masiva con `access.sod_conflict`: la persona es oficial de seguridad y la
 * capacidad es exclusiva de owner. Guarda el cuerpo que se intentó, que es lo que reenvía la
 * excepción (sobre TODOS los destinos del lote).
 */
interface SodBlock {
  body: CapabilityGrantBulkCreate
  conflicts: SodConflict[]
  reasonMinLength?: number
  maxHours?: number
}

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

/** «1 capacidad», «3 capacidades»: el sustantivo concuerda con el número. */
function countLabel(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** Texto de un destino que falló en el alta masiva: copy propio si lo hay, si no el del backend. */
function bulkFailureText(failure: ApiGrantBulkFailure): string {
  const known =
    failure.code === CAPABILITY_GRANT_ERROR_CODES.grantDuplicate ||
    failure.code === CAPABILITY_GRANT_ERROR_CODES.grantScopeNotFound
  return (
    (known ? capabilityGrantBlockedMessage(failure.code) : null) ??
    failure.message ??
    failure.code ??
    'No se puede otorgar este destino.'
  )
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
 * **Se monta solo con `access.admin`** (la tiene solo `access_admin`): pedir el listado sin ella
 * sería un 403 seguro. Quien monta esto decide; acá no se vuelve a preguntar, así que las consultas se disparan
 * apenas se monta.
 *
 * **Es inmediato, no pasa por «Guardar accesos».** `PUT /access` no toca las capacidades puntuales
 * (las conserva), y estas tienen sus propios endpoints: el texto de la cabecera lo dice porque, en
 * una página cuya barra inferior guarda «el estado completo», lo contrario es lo que se asumiría.
 *
 * Una capacidad sensible no se concede al crearla: queda `pending` hasta que OTRA persona con
 * `access_admin` la apruebe (bandeja: `PendingCapabilityGrantsCard`). La UI lo dice antes de enviar y después de enviar,
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
  const duplicateId = `${ids}-duplicadas`
  const errorId = `${ids}-error`
  const detailId = `${ids}-detalle`
  const counterId = `${ids}-contador`

  const [showHistory, setShowHistory] = useState(false)
  const [capabilityIds, setCapabilityIds] = useState<string[]>([])
  const [scopeType, setScopeType] = useState<ScopeType>('environment')
  const [scopeIds, setScopeIds] = useState<number[]>([])
  const [reason, setReason] = useState('')
  const [toRevoke, setToRevoke] = useState<CapabilityGrant | null>(null)
  const [sodBlock, setSodBlock] = useState<SodBlock | null>(null)

  const grantsQuery = useCapabilityGrants(user.id)
  const create = useCreateCapabilityGrantsBulk(user.id)
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

  // Se conserva el orden en que se eligieron y se descarta lo que ya no es otorgable (el catálogo
  // se refrescó): el cuerpo solo lleva ids que el selector todavía ofrece.
  const selectedCapabilities = capabilityIds.flatMap((id) => {
    const row = grantable.find((candidate) => candidate.id === id)
    return row ? [row] : []
  })
  const selectedCapabilityIds = selectedCapabilities.map((row) => row.id)
  const sensitiveSelected = selectedCapabilities.filter((row) =>
    isSensitiveCapability(row.id, catalog),
  )
  const targets: TargetOption[] =
    scopeType === 'environment'
      ? environments.selectable.map((env) => ({ id: env.id, label: env.name }))
      : (servers.data ?? []).map((server) => ({ id: server.id, label: server.name }))

  // Destinos que ya tienen ALGUNA de las capacidades elegidas VIVA (activa o pendiente): no se
  // ofrecen. El lote es el producto cartesiano capacidades x destinos y es todo o nada, así que un
  // solo par repetido lo tumba entero. Es una pista con la lista que ya está en pantalla; el
  // `UNIQUE` del backend sigue siendo la verdad (409 `access.grant_bulk_failed` con
  // `access.grant_duplicate` por par).
  const liveTargetIds = useMemo(
    () =>
      new Set(
        live
          .filter(
            (grant) => capabilityIds.includes(grant.capability) && grant.scope_type === scopeType,
          )
          .map((grant) => grant.scope_id),
      ),
    [live, capabilityIds, scopeType],
  )
  const available = targets.filter((option) => !liveTargetIds.has(option.id))
  const alreadyGranted = targets.length - available.length
  // Lo elegido que dejó de ser ofrecible (cambió la capacidad) se descarta sin tocar el estado.
  const selectedTargets = available.filter((option) => scopeIds.includes(option.id))
  const selectedIds = selectedTargets.map((option) => option.id)
  // Cada par capacidad x destino es una fila: el tope de 100 es sobre el PRODUCTO, no sobre cada
  // lista (el backend lo rechaza con 422 `access.grant_bulk_too_large`).
  const combinations = selectedCapabilityIds.length * selectedIds.length
  const tooMany = combinations > CAPABILITY_GRANT_BULK_MAX
  // Cuántos destinos caben con las capacidades elegidas: lo que «Seleccionar todos» puede marcar.
  const maxTargetsForSelection = Math.floor(
    CAPABILITY_GRANT_BULK_MAX / Math.max(1, selectedCapabilityIds.length),
  )
  const selectAllCount = Math.min(available.length, maxTargetsForSelection)

  // Los dos bloqueos son del DESTINO de la operación y el backend los rechaza antes que cualquier
  // otro chequeo: se explican acá, con el copy de siempre, en vez de dejar llegar a un 409.
  const blockedReason = isSelf
    ? capabilityGrantBlockedMessage(CAPABILITY_GRANT_ERROR_CODES.selfModificationForbidden)
    : !user.is_active
      ? capabilityGrantBlockedMessage(CAPABILITY_GRANT_ERROR_CODES.grantUserInactive)
      : null

  const canSubmit =
    selectedCapabilityIds.length >= 1 &&
    selectedIds.length >= 1 &&
    !tooMany &&
    blockedReason === null &&
    reason.length <= REASON_MAX

  // Un cambio de cualquier campo descarta el resultado o el error anterior: ya no hablan de lo que
  // hay en el formulario.
  const touch = () => {
    if (!create.isIdle) create.reset()
    setSodBlock(null)
  }

  // Con el rechazo de separación de deberes a la vista, el error vive en su panel: ahí está el
  // botón que lo resuelve (o lo vuelve a intentar).
  const bulkFailures =
    (create.isError && toApiError(create.error).gatewayUserContext?.grantBulkFailures) || []
  const sodFailures = bulkFailures.filter(
    (failure) => failure.code === CAPABILITY_GRANT_ERROR_CODES.sodConflict,
  )
  // Los destinos con conflicto de separación de deberes tienen su panel; el resto, su lista.
  const listedFailures = sodBlock
    ? bulkFailures.filter((f) => !sodFailures.includes(f))
    : bulkFailures
  const createErrorMessage = (() => {
    if (!create.isError) return null
    // El 403 usa el copy compartido (el toast ya dice lo mismo): el aviso del formulario queda
    // legible aunque el toast se haya cerrado.
    if (isAccessForbidden(create.error)) return forbiddenCopy().body
    const apiError = toApiError(create.error)
    return capabilityGrantErrorMessage(apiError) ?? apiError.message
  })()
  const sodRejectedAgain = sodFailures.length > 0
  const formError = sodBlock ? null : createErrorMessage
  const overrideError = sodBlock && !sodRejectedAgain ? createErrorMessage : null

  const send = (body: CapabilityGrantBulkCreate) => {
    create.mutate(body, {
      onSuccess: () => {
        // Se limpia lo que se eligió pero se deja el tipo de destino: otorgar varias seguidas
        // sobre el mismo tipo es lo habitual.
        setCapabilityIds([])
        setScopeIds([])
        setReason('')
        setSodBlock(null)
      },
      onError: (error) => {
        const failures = toApiError(error).gatewayUserContext?.grantBulkFailures ?? []
        const sod = failures.filter((f) => f.code === CAPABILITY_GRANT_ERROR_CODES.sodConflict)
        if (sod.length === 0) return
        const { sod_override: _override, ...plain } = body
        // Un conflicto por destino: se juntan las reglas sin repetir la misma fuente.
        const conflicts = new Map(
          sod.flatMap((f) => f.sodConflicts ?? []).map((c) => [JSON.stringify(c), c]),
        )
        setSodBlock({
          body: plain,
          conflicts: [...conflicts.values()],
          reasonMinLength: sod.find((f) => f.sodReasonMinLength)?.sodReasonMinLength,
          maxHours: sod.find((f) => f.sodMaxHours)?.sodMaxHours,
        })
      },
    })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    const trimmed = reason.trim()
    send({
      // Con UNA capacidad se manda `capability` (la forma de siempre, compatible con un backend
      // anterior); con varias, `capabilities`. El backend exige exactamente una de las dos.
      ...(selectedCapabilityIds.length === 1
        ? { capability: selectedCapabilityIds[0] }
        : { capabilities: selectedCapabilityIds }),
      scope_type: scopeType,
      scope_ids: selectedIds,
      ...(trimmed ? { reason: trimmed } : {}),
    })
  }

  const resendWithOverride = (override: SodOverrideIn) => {
    if (sodBlock) send({ ...sodBlock.body, sod_override: override })
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
  const createdGrants = create.isSuccess ? create.data.grants : []
  const createdCapabilities = [...new Set(createdGrants.map((grant) => grant.capability))]
  const createdCapabilitiesText = createdCapabilities.map(capabilityName).join(', ')
  const createdTargets = [
    ...new Set(createdGrants.map((grant) => grant.scope_name ?? `#${grant.scope_id}`)),
  ].join(', ')
  // Con varias capacidades las filas pueden nacer con estados distintos: se cuentan, no se asumen.
  const createdPending = createdGrants.filter((grant) => grant.status === 'pending').length
  const createdActive = createdGrants.length - createdPending

  return (
    <Card>
      <section aria-labelledby={headingId}>
        <CardHeader>
          <h2 id={headingId} className="text-base font-semibold text-foreground">
            Capacidades puntuales
          </h2>
          <p className="text-sm text-muted-foreground">
            Suman una o varias capacidades sobre uno o varios entornos o servidores sin cambiar el
            rol de {user.username}. Se aplican al instante, sin pasar por «Guardar accesos», y esa
            pantalla no las toca.
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

            <MultiCombobox<CapabilityDescriptor>
              items={grantable}
              selectedItems={selectedCapabilities}
              onChange={(rows) => {
                touch()
                setCapabilityIds(rows.map((row) => row.id))
              }}
              itemToString={(row) => row.label}
              itemToKey={(row) => row.id}
              renderItem={(row) => (
                <span className="flex flex-col items-start gap-0.5">
                  <span>{row.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    <code className="font-mono">{row.id}</code> · {moduleLabel(row.module)}
                  </span>
                  {/* Espejo de `is_sensitive` (C3): otorgable y exclusiva de owner. */}
                  {isSensitiveCapability(row.id, catalog) && <SecondApproverBadge />}
                </span>
              )}
              label="Capacidades"
              placeholder="Elegí una o varias capacidades"
              disabled={blockedReason !== null || isCatalogLoading}
            />
            {isCatalogLoading && (
              <span className="text-xs text-muted-foreground">Cargando capacidades…</span>
            )}
            {!isCatalogLoading && grantable.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay capacidades para otorgar de forma puntual: el catálogo no publicó ninguna.
              </p>
            )}

            {selectedCapabilities.length > 0 && (
              <div id={detailId} className="flex flex-col gap-2 text-xs text-muted-foreground">
                {selectedCapabilities.map((row) => (
                  <div key={row.id} className="flex flex-col gap-1">
                    <code className="font-mono">{row.id}</code>
                    {row.implies.length > 0 && (
                      <span>Incluye la lectura: {row.implies.map(capabilityName).join(', ')}.</span>
                    )}
                  </div>
                ))}
                {sensitiveSelected.length > 0 && (
                  <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                    <SecondApproverBadge />
                    <span>
                      {selectedCapabilities.length === 1
                        ? 'Queda pendiente y no concede acceso hasta que otra persona con access_admin la apruebe.'
                        : `${countLabel(sensitiveSelected.length, 'de las elegidas queda', 'de las elegidas quedan')} pendiente${sensitiveSelected.length === 1 ? '' : 's'} y no concede${sensitiveSelected.length === 1 ? '' : 'n'} acceso hasta que otra persona con access_admin la${sensitiveSelected.length === 1 ? '' : 's'} apruebe (${sensitiveSelected.map((row) => row.label).join(', ')}). Las demás rigen al instante.`}
                    </span>
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
                  setScopeIds([])
                }}
                itemToString={(option) => option.label}
                itemToKey={(option) => option.value}
                label="Tipo de destino"
                disabled={blockedReason !== null}
              />
              <div className="flex flex-col gap-1.5">
                <MultiCombobox<TargetOption>
                  items={available}
                  selectedItems={selectedTargets}
                  onChange={(options) => {
                    touch()
                    setScopeIds(options.map((option) => option.id))
                  }}
                  itemToString={(option) => option.label}
                  itemToKey={(option) => option.id}
                  label={
                    scopeType === 'environment' ? 'Entornos de destino' : 'Servidores de destino'
                  }
                  placeholder="Elegí uno o varios destinos"
                  disabled={blockedReason !== null}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      blockedReason !== null ||
                      selectAllCount === 0 ||
                      selectedIds.length === selectAllCount
                    }
                    onClick={() => {
                      touch()
                      setScopeIds(available.slice(0, selectAllCount).map((option) => option.id))
                    }}
                  >
                    Seleccionar todos ({selectAllCount})
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={blockedReason !== null || selectedIds.length === 0}
                    onClick={() => {
                      touch()
                      setScopeIds([])
                    }}
                  >
                    Limpiar
                  </Button>
                  {(scopeType === 'environment' ? environments.isPending : servers.isPending) && (
                    <span className="text-xs text-muted-foreground">Cargando destinos…</span>
                  )}
                </div>
                {alreadyGranted > 0 && (
                  <p id={duplicateId} role="status" className="text-xs text-muted-foreground">
                    {alreadyGranted === 1
                      ? '1 destino ya tiene'
                      : `${alreadyGranted} destinos ya tienen`}{' '}
                    {selectedCapabilityIds.length === 1
                      ? 'esa capacidad'
                      : 'al menos una de esas capacidades'}{' '}
                    (activa o pendiente de aprobación) y no se ofrece
                    {alreadyGranted === 1 ? '' : 'n'}.
                  </p>
                )}
              </div>
            </div>

            {/* Contador en vivo: cada par capacidad x destino es una fila y el lote pasa o falla
                entero, así que se ve el producto ANTES de enviar y el motivo del bloqueo si pasa de
                100. `role="status"` solo cuando hay bloqueo: un contador que anuncia cada
                clic sería ruido. */}
            {(selectedCapabilityIds.length > 0 || selectedIds.length > 0) && (
              <p
                id={counterId}
                role={tooMany ? 'alert' : undefined}
                className={tooMany ? 'text-sm text-error' : 'text-sm text-muted-foreground'}
              >
                {countLabel(selectedCapabilityIds.length, 'capacidad', 'capacidades')} x{' '}
                {countLabel(selectedIds.length, 'destino', 'destinos')} ={' '}
                {countLabel(combinations, 'combinación', 'combinaciones')}
                {tooMany &&
                  `. Máximo ${CAPABILITY_GRANT_BULK_MAX} por vez: quitá capacidades o destinos para poder otorgar.`}
              </p>
            )}

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

            {/* `role="alert"`: el error llega después de apretar y tiene que anunciarse. Va junto
                al botón, no solo en el toast, que se cierra solo. */}
            {formError && (
              <p id={errorId} role="alert" className="text-sm text-error">
                {formError}
              </p>
            )}

            {listedFailures.length > 0 && (
              <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-error">
                {listedFailures.map((failure) => (
                  <li key={`${failure.capability ?? ''}:${failure.scopeId}`}>
                    {failure.capability && (
                      <>
                        <strong>{capabilityName(failure.capability)}</strong> en{' '}
                      </>
                    )}
                    <strong>
                      {targets.find((option) => option.id === failure.scopeId)?.label ??
                        `#${failure.scopeId}`}
                    </strong>
                    : {bulkFailureText(failure)}
                  </li>
                ))}
              </ul>
            )}

            {sodBlock && (
              <SodConflictPanel
                conflicts={sodBlock.conflicts}
                labelOptions={{
                  capabilityLabel: (id) => catalog?.find((row) => row.id === id)?.label,
                  targetLabel: (type, id) =>
                    type === scopeType
                      ? targets.find((option) => option.id === id)?.label
                      : undefined,
                }}
                reasonMinLength={sodBlock.reasonMinLength}
                maxHours={sodBlock.maxHours}
                onResend={resendWithOverride}
                isPending={create.isPending}
                resendError={overrideError}
                resendLabel="Otorgar con excepción de emergencia"
              />
            )}

            {create.isSuccess && createdGrants.length > 0 && (
              <p role="status" className="text-sm text-foreground">
                {createdPending === 0 ? (
                  <>
                    <strong>
                      {createdCapabilities.length > 1
                        ? `${countLabel(create.data.count, 'capacidad otorgada', 'capacidades otorgadas')}.`
                        : create.data.count === 1
                          ? 'Capacidad otorgada.'
                          : `Capacidad otorgada en ${create.data.count} destinos.`}
                    </strong>{' '}
                    {createdCapabilitiesText} en {createdTargets} ya rige.
                  </>
                ) : createdActive === 0 ? (
                  <>
                    <strong>
                      {create.data.count === 1 ? 'Solicitud enviada' : 'Solicitudes enviadas'},
                      todavía no conceden acceso.
                    </strong>{' '}
                    {createdCapabilitiesText} en {createdTargets} queda
                    {create.data.count === 1 ? '' : 'n'} pendiente
                    {create.data.count === 1 ? '' : 's'} hasta que otra persona con access_admin la
                    {create.data.count === 1 ? '' : 's'} apruebe.
                  </>
                ) : (
                  <>
                    <strong>
                      Se otorgaron {createdGrants.length} combinaciones: {createdActive} ya{' '}
                      {createdActive === 1 ? 'rige' : 'rigen'} y {createdPending}{' '}
                      {createdPending === 1 ? 'queda pendiente' : 'quedan pendientes'}.
                    </strong>{' '}
                    {createdCapabilitiesText} en {createdTargets}.
                  </>
                )}
                {createdPending > 0 && (
                  <span className="mt-1 block text-muted-foreground">
                    Pendientes de aprobación: {createdPending} de {createdGrants.length}. No
                    conceden acceso hasta que otra persona con access_admin las apruebe.
                  </span>
                )}
              </p>
            )}

            <div>
              <Button
                type="submit"
                size="sm"
                disabled={!canSubmit}
                isLoading={create.isPending}
                aria-describedby={blockedReason ? blockedId : undefined}
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
