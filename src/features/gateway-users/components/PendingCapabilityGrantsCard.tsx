import { createContext, useCallback, useContext, useId, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
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
import {
  CAPABILITY_GRANT_DECISION_BULK_MAX,
  type CapabilityGrantDecisionBulkResult,
  type CapabilityGrantDecisionKind,
  type PendingCapabilityGrant,
  type ScopeType,
} from '@/lib/contracts'
import { formatDateTime } from '@/lib/utils/format'
import {
  useApproveCapabilityGrant,
  useDecideCapabilityGrantsBulk,
  usePendingCapabilityGrants,
  useRejectCapabilityGrant,
} from '../hooks/use-capability-grants'
import {
  capabilityGrantBlockedMessage,
  capabilityGrantDecisionItemMessage,
  capabilityGrantErrorMessage,
} from '../messages'

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

/** Una solicitud que el lote no pudo decidir, ya con el texto que se le muestra a la persona. */
interface BulkFailureRow {
  id: number
  subject: string
  message: string
}

/**
 * Resultado de la última decisión masiva. Se arma al terminar la llamada y NO se recalcula desde
 * la bandeja: las decididas ya salieron de la lista, y la fila que falló tiene que seguir
 * nombrándose aunque la bandeja se refresque.
 */
interface BulkSummary {
  decision: CapabilityGrantDecisionKind
  requested: number
  succeeded: number
  failures: BulkFailureRow[]
}

/** «cap» o «caps»: el sustantivo concuerda con el número del botón y del diálogo. */
function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm
}

/**
 * Estado de la selección masiva que leen las filas. Va por contexto y NO dentro de las columnas:
 * `DataTable` monta cada celda como un componente, así que unas columnas que cambian con cada clic
 * remontarían las casillas y quien navega con teclado perdería el foco al marcar una.
 */
interface RowSelection {
  isSelected: (grantId: number) => boolean
  toggle: (grantId: number, checked: boolean) => void
  /** Hay una decisión masiva en vuelo: todo lo que decide queda quieto hasta que termine. */
  busy: boolean
}

const RowSelectionContext = createContext<RowSelection>({
  isSelected: () => false,
  toggle: () => undefined,
  busy: false,
})

interface GrantRowActionsProps {
  grant: PendingCapabilityGrant
  /** «Capacidad de persona en alcance»: el nombre accesible dice QUÉ y de QUIÉN en cada fila. */
  subject: string
  blockedId: string
  onDecide: (decision: Decision) => void
}

/** Casilla de selección + Aprobar/Rechazar de una fila, con el motivo cuando no se puede decidir. */
function GrantRowActions({ grant, subject, blockedId, onDecide }: GrantRowActionsProps) {
  const selection = useContext(RowSelectionContext)
  const blocked = grant.can_decide
    ? null
    : (capabilityGrantBlockedMessage(grant.blocked_reason) ??
      capabilityGrantBlockedMessage('unknown'))
  const disabled = !grant.can_decide || selection.busy
  return (
    <div className="flex flex-col items-start gap-2">
      {/* Casilla propia (no `Checkbox`): la etiqueta visible repetiría el asunto en cada fila; el
          nombre accesible dice QUÉ y de QUIÉN. Deshabilitada con el mismo motivo que los botones
          cuando `can_decide` es `false`. */}
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 rounded border-input text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        aria-label={`Seleccionar: ${subject}`}
        aria-describedby={blocked ? blockedId : undefined}
        checked={grant.can_decide && selection.isSelected(grant.id)}
        disabled={disabled}
        onChange={(event) => selection.toggle(grant.id, event.target.checked)}
      />
      {/* Acciones de dominio: conservan el texto. El nombre accesible dice QUÉ y de QUIÉN porque
          hay un par de botones por fila. */}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-describedby={blocked ? blockedId : undefined}
          aria-label={`Aprobar: ${subject}`}
          onClick={() => onDecide({ kind: 'approve', grant })}
        >
          Aprobar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-describedby={blocked ? blockedId : undefined}
          aria-label={`Rechazar: ${subject}`}
          onClick={() => onDecide({ kind: 'reject', grant })}
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
}

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
  const bulk = useDecideCapabilityGrantsBulk()

  const [decision, setDecision] = useState<Decision | null>(null)
  const [reason, setReason] = useState('')
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set())
  const [bulkDecision, setBulkDecision] = useState<CapabilityGrantDecisionKind | null>(null)
  const [bulkReason, setBulkReason] = useState('')
  const [summary, setSummary] = useState<BulkSummary | null>(null)

  const capabilityName = useCallback(
    (id: string) => catalog?.find((row) => row.id === id)?.label ?? id,
    [catalog],
  )

  /** «Aprobar: Borrar bases de datos de mlopez en Servidor · db-01»: qué y de quién, en una línea. */
  const grantSubject = useCallback(
    (grant: PendingCapabilityGrant) =>
      `${capabilityName(grant.capability)} de ${grant.username ?? grant.user_id} en ${scopeLabel(grant)}`,
    [capabilityName],
  )

  // Solo se puede elegir lo que el servidor dice que se puede decidir (`can_decide`). La selección
  // se cruza con la bandeja actual: una fila que desapareció (la decidió otra persona, venció) deja
  // de contar sin tener que limpiar nada a mano.
  const decidableRows = (pending.data ?? []).filter((grant) => grant.can_decide)
  const selectedGrants = decidableRows.filter((grant) => selection.has(grant.id))
  const blockedCount = (pending.data ?? []).length - decidableRows.length
  const selectableLimit = Math.min(decidableRows.length, CAPABILITY_GRANT_DECISION_BULK_MAX)
  const allSelected = selectableLimit > 0 && selectedGrants.length === selectableLimit
  const someSelected = selectedGrants.length > 0 && !allSelected
  const overLimit = selectedGrants.length > CAPABILITY_GRANT_DECISION_BULK_MAX

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

  const toggleSelected = useCallback((grantId: number, checked: boolean) => {
    setSelection((current) => {
      const next = new Set(current)
      if (checked) next.add(grantId)
      else next.delete(grantId)
      return next
    })
  }, [])

  const toggleAll = (checked: boolean) => {
    setSelection(
      checked
        ? new Set(decidableRows.slice(0, CAPABILITY_GRANT_DECISION_BULK_MAX).map((row) => row.id))
        : new Set(),
    )
  }

  const bulkDialogError = (() => {
    if (!bulk.isError) return null
    if (isAccessForbidden(bulk.error)) return forbiddenCopy().body
    const apiError = toApiError(bulk.error)
    return capabilityGrantErrorMessage(apiError, { decision: true }) ?? apiError.message
  })()

  const { reset: resetBulk } = bulk
  const openBulk = (next: CapabilityGrantDecisionKind) => {
    resetBulk()
    setBulkReason('')
    setBulkDecision(next)
  }
  const closeBulk = () => {
    setBulkDecision(null)
    setBulkReason('')
    resetBulk()
  }

  const confirmBulk = () => {
    if (!bulkDecision || selectedGrants.length === 0) return
    const subjects = new Map(selectedGrants.map((grant) => [grant.id, grantSubject(grant)]))
    bulk.mutate(
      {
        decision: bulkDecision,
        ids: selectedGrants.map((grant) => grant.id),
        reason: bulkReason,
      },
      {
        onSuccess: (result: CapabilityGrantDecisionBulkResult) => {
          const decidedIds = new Set(result.results.flatMap((item) => (item.ok ? [item.id] : [])))
          const failures = result.results.flatMap((item): BulkFailureRow[] =>
            item.ok
              ? []
              : [
                  {
                    id: item.id,
                    subject: subjects.get(item.id) ?? `Solicitud #${item.id}`,
                    message: capabilityGrantDecisionItemMessage(item.code, item.message),
                  },
                ],
          )
          setSummary({
            decision: bulkDecision,
            requested: result.requested,
            succeeded: result.succeeded,
            failures,
          })
          // Las decididas salen de la selección (y de la bandeja al refrescar); las que fallaron
          // siguen elegidas para reintentarlas o para revisar por qué.
          setSelection((current) => new Set([...current].filter((id) => !decidedIds.has(id))))
          closeBulk()
        },
      },
    )
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
          return (
            <GrantRowActions
              grant={grant}
              subject={grantSubject(grant)}
              blockedId={`${ids}-bloqueo-${grant.id}`}
              onDecide={open}
            />
          )
        },
      },
    ],
    [capabilityName, grantSubject, ids, open],
  )

  const approving = decision?.kind === 'approve'
  const bulkApproving = bulkDecision === 'approve'
  const selectedCount = selectedGrants.length
  const bulkVerb = summary?.decision === 'approve' ? 'aprobadas' : 'rechazadas'

  const rowSelection = useMemo<RowSelection>(
    () => ({
      isSelected: (grantId) => selection.has(grantId),
      toggle: toggleSelected,
      busy: bulk.isPending,
    }),
    [selection, toggleSelected, bulk.isPending],
  )

  return (
    <RowSelectionContext.Provider value={rowSelection}>
      <Card>
        <section aria-labelledby={headingId}>
          <CardHeader>
            <h2 id={headingId} className="text-base font-semibold text-foreground">
              Capacidades puntuales
            </h2>
            <p className="text-sm text-muted-foreground">
              Capacidades sensibles (las exclusivas de owner) o con excepción de emergencia que
              pidió una persona con access_admin. No rigen hasta que las apruebe otra persona con
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
              <div className="flex flex-col gap-3">
                {summary && (
                  <Callout
                    tone={summary.failures.length === 0 ? 'success' : 'warning'}
                    title={`${summary.succeeded} de ${summary.requested} ${bulkVerb}`}
                    action={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSummary(null)}
                      >
                        Cerrar resumen
                      </Button>
                    }
                  >
                    {summary.failures.length > 0 && (
                      <>
                        <p>
                          {summary.failures.length}{' '}
                          {plural(
                            summary.failures.length,
                            'solicitud no se pudo',
                            'solicitudes no se pudieron',
                          )}{' '}
                          decidir. El resto se procesó igual.
                        </p>
                        <ul className="flex list-disc flex-col gap-1 pl-5">
                          {summary.failures.map((failure) => (
                            <li key={failure.id}>
                              <strong className="text-foreground">{failure.subject}</strong>:{' '}
                              {failure.message}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </Callout>
                )}

                {selectedCount > 0 && (
                  <div
                    role="region"
                    aria-label="Acciones sobre las solicitudes seleccionadas"
                    className="flex flex-wrap items-center gap-2 rounded-card border border-primary/30 bg-primary/10 px-4 py-2"
                  >
                    <span aria-live="polite" className="text-sm font-medium text-foreground">
                      {selectedCount} {plural(selectedCount, 'seleccionada', 'seleccionadas')}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={bulk.isPending || overLimit}
                      onClick={() => openBulk('approve')}
                    >
                      Aprobar {selectedCount}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={bulk.isPending || overLimit}
                      onClick={() => openBulk('reject')}
                    >
                      Rechazar {selectedCount}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={bulk.isPending}
                      onClick={() => setSelection(new Set())}
                    >
                      Limpiar selección
                    </Button>
                  </div>
                )}

                <DataTable<PendingCapabilityGrant>
                  data={pending.data ?? []}
                  columns={columns}
                  isLoading={pending.isLoading}
                  isFetching={pending.isFetching}
                  enableGlobalFilter={false}
                  getRowId={(grant) => String(grant.id)}
                  toolbar={
                    decidableRows.length > 0 ? (
                      <Checkbox
                        label={`Seleccionar todas (${selectableLimit})`}
                        hint={
                          blockedCount > 0
                            ? `${blockedCount} ${plural(blockedCount, 'no se puede', 'no se pueden')} decidir y ${plural(blockedCount, 'queda', 'quedan')} fuera.`
                            : decidableRows.length > CAPABILITY_GRANT_DECISION_BULK_MAX
                              ? `Máximo ${CAPABILITY_GRANT_DECISION_BULK_MAX} por vez.`
                              : undefined
                        }
                        checked={allSelected}
                        ref={(element) => {
                          if (element) element.indeterminate = someSelected
                        }}
                        disabled={bulk.isPending}
                        onChange={(event) => toggleAll(event.target.checked)}
                      />
                    ) : undefined
                  }
                  emptyState={
                    <EmptyState
                      title="No hay capacidades puntuales pendientes"
                      description="Cuando alguien pida una capacidad sensible para otra persona, aparece acá para que la decida un segundo administrador de accesos."
                    />
                  }
                />
              </div>
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

        {bulkDecision && (
          <ConfirmDialog
            open
            onClose={closeBulk}
            onConfirm={confirmBulk}
            title={
              bulkApproving
                ? `¿Aprobar ${selectedCount} ${plural(selectedCount, 'capacidad', 'capacidades')}?`
                : `¿Rechazar ${selectedCount} ${plural(selectedCount, 'solicitud', 'solicitudes')}?`
            }
            description={
              bulkApproving
                ? `${plural(selectedCount, 'La capacidad pasa', `Las ${selectedCount} capacidades pasan`)} a regir al instante para ${plural(selectedCount, 'la persona que la pidió', 'las personas que las pidieron')}. Son sensibles (exclusivas de owner) o llevan una excepción de emergencia: revisá la lista antes de confirmar. Si alguna ya no se puede aprobar, las demás se aprueban igual y se te dice cuál falló.`
                : `${plural(selectedCount, 'La solicitud se cierra y no llega', `Las ${selectedCount} solicitudes se cierran y no llegan`)} a concederse. Se pueden volver a pedir. Si alguna ya no se puede rechazar, las demás se rechazan igual y se te dice cuál falló.`
            }
            confirmLabel={
              bulkApproving
                ? `Aprobar ${selectedCount} ${plural(selectedCount, 'capacidad', 'capacidades')}`
                : `Rechazar ${selectedCount} ${plural(selectedCount, 'solicitud', 'solicitudes')}`
            }
            tone={bulkApproving ? 'primary' : 'danger'}
            isLoading={bulk.isPending}
            confirmDisabled={selectedCount === 0}
          >
            <ul
              aria-label="Solicitudes del lote"
              className="flex max-h-40 list-disc flex-col gap-1 overflow-y-auto pl-5 text-sm text-foreground"
            >
              {selectedGrants.map((grant) => (
                <li key={grant.id}>{grantSubject(grant)}</li>
              ))}
            </ul>
            <Textarea
              label="Motivo"
              value={bulkReason}
              onChange={(event) => setBulkReason(event.target.value)}
              maxLength={REASON_MAX}
              hint={`Opcional, queda en el historial de cada solicitud. ${bulkReason.length}/${REASON_MAX}`}
              className="min-h-16"
            />
            {/* `role="alert"`: el error llega después de apretar y tiene que anunciarse. */}
            {bulkDialogError && (
              <p id={`${reasonId}-bulk-error`} role="alert" className="text-sm text-error">
                {bulkDialogError}
              </p>
            )}
          </ConfirmDialog>
        )}
      </Card>
    </RowSelectionContext.Provider>
  )
}
