import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  EmptyState,
  ErrorState,
  EyeIcon,
  IconButton,
  PageHeader,
  Pagination,
  RefreshIcon,
} from '@/components/ui'
import { ForbiddenState, isAccessForbidden, useCapabilities, useSession } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import { AUDIT_ERROR_CODES, CAPABILITIES, type AuditLogEntry } from '@/lib/contracts'
import { formatUtcDateTime } from '@/lib/utils/format'
import {
  AUDIT_ENTRY_PARAM,
  auditActorLabel,
  auditQueryParams,
  auditStatus,
  auditTargetLabel,
  hasAuditFilters,
  isInvalidRange,
  parseAuditSearch,
  writeAuditSearch,
} from '../audit-model'
import { AuditEntryDetailModal } from '../components/AuditEntryDetailModal'
import { AuditFilterBar } from '../components/AuditFilterBar'
import { useAuditLog } from '../hooks/use-audit-log'

/**
 * «Auditoría» (`/audit-log`, api-reference-v29 §11.3) — el rastro de quién hizo qué en el gateway.
 *
 * Solo `policy.admin`, que tiene solo `security_officer`: **lee el rastro quien no hace los cambios
 * de acceso**. Un `access_admin` sin `security_officer` recibe el 403 compartido, a propósito. La
 * lectura no pide step-up.
 *
 * Los filtros, la página y la entrada abierta viven en la URL: una búsqueda se comparte o se
 * recarga tal cual, y «atrás» deshace un filtro. Orden y paginación son del servidor (las más
 * nuevas primero, estable entre páginas), así que la tabla no ofrece búsqueda local: filtraría
 * solo la página en pantalla y parecería que no hay más.
 */
export function AuditLogPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = parseAuditSearch(searchParams)
  const canRead = useCapabilities().can(CAPABILITIES.policyAdmin)
  // Antes de que llegue la sesión `can()` falla abierto: se espera para no pedir un 403 seguro.
  const { admin } = useSession()
  const invalidRange = isInvalidRange(state.filters)
  const { data, isLoading, isFetching, isError, error, refetch } = useAuditLog(
    auditQueryParams(state),
    admin !== null && canRead && !invalidRange,
  )
  const forbidden = !canRead || isAccessForbidden(error)

  const openId = Number(searchParams.get(AUDIT_ENTRY_PARAM))
  const openEntryId = Number.isInteger(openId) && openId > 0 ? openId : null

  const update = (next: Partial<typeof state>) =>
    setSearchParams((previous) => writeAuditSearch(previous, { ...state, ...next }))
  const setEntry = useCallback(
    (id: number | null) =>
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous)
        if (id === null) next.delete(AUDIT_ENTRY_PARAM)
        else next.set(AUDIT_ENTRY_PARAM, String(id))
        return next
      }),
    [setSearchParams],
  )

  const columns = useMemo<ColumnDef<AuditLogEntry>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: 'Fecha',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {formatUtcDateTime(row.original.created_at)}
          </span>
        ),
      },
      {
        accessorKey: 'action',
        header: 'Acción',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1">
            <code className="break-all font-mono text-xs text-foreground">
              {row.original.action}
            </code>
            {row.original.touched_engine && (
              <span title="Tocó el motor" aria-label="tocó el motor">
                🔌
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'actor',
        header: 'Actor',
        enableSorting: false,
        cell: ({ row }) => {
          const label = auditActorLabel(row.original)
          const kind = row.original.actor_type
          return kind === 'system' || kind === 'anonymous' ? (
            <Badge tone="neutral">{label}</Badge>
          ) : (
            <span className="break-words text-foreground">{label}</span>
          )
        },
      },
      {
        id: 'target',
        header: 'Destino',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{auditTargetLabel(row.original) ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Estado',
        enableSorting: false,
        cell: ({ row }) => {
          const status = auditStatus(row.original.status)
          return <Badge tone={status.tone}>{status.label}</Badge>
        },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <IconButton
              label={`Ver detalle de la entrada #${row.original.id}`}
              icon={<EyeIcon className="h-4 w-4" />}
              onClick={() => setEntry(row.original.id)}
            />
          </div>
        ),
      },
    ],
    [setEntry],
  )

  const filtered = hasAuditFilters(state.filters)
  const apiError = isError ? toApiError(error) : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Auditoría"
        description="Quién hizo qué en el gateway, las entradas más nuevas primero. Las fechas se muestran en tu hora local."
        actions={
          forbidden ? undefined : (
            <IconButton
              label="Actualizar"
              size="icon"
              icon={<RefreshIcon className="h-4 w-4" />}
              onClick={() => void refetch()}
              disabled={isFetching || invalidRange}
            />
          )
        }
      />

      {forbidden ? (
        <ForbiddenState title="No tenés acceso a la auditoría" />
      ) : (
        <>
          <Card>
            <CardContent>
              {/* `key`: la barra edita un borrador inicializado desde la URL; cuando la URL cambia
                  desde afuera se remonta en vez de sincronizarse con un efecto. */}
              <AuditFilterBar
                key={writeAuditSearch(new URLSearchParams(), { ...state, page: 1 }).toString()}
                filters={state.filters}
                onApply={(filters) => update({ filters, page: 1 })}
                onClear={() => update({ filters: {}, page: 1 })}
              />
            </CardContent>
          </Card>

          {isError ? (
            <ErrorState
              error={error}
              message={
                apiError?.code === AUDIT_ERROR_CODES.invalidRange
                  ? '«Hasta» tiene que ser posterior a «Desde».'
                  : undefined
              }
              onRetry={() => void refetch()}
            />
          ) : (
            <>
              <DataTable
                data={data?.items ?? []}
                columns={columns}
                isLoading={isLoading}
                isFetching={isFetching}
                enableGlobalFilter={false}
                getRowId={(row) => String(row.id)}
                emptyState={
                  filtered ? (
                    <EmptyState
                      title="Ninguna entrada coincide con los filtros"
                      description="Probá con un rango de fechas más amplio o quitá algún filtro."
                      action={
                        <Button variant="outline" onClick={() => update({ filters: {}, page: 1 })}>
                          Limpiar filtros
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      title="Todavía no hay entradas"
                      description="Cuando alguien opere el gateway, sus acciones van a aparecer acá."
                    />
                  )
                }
              />
              {data && data.pagination.total > 0 && (
                <Pagination
                  page={data.pagination.page}
                  pages={data.pagination.pages}
                  total={data.pagination.total}
                  size={data.pagination.size}
                  hasNext={data.pagination.has_next}
                  hasPrev={data.pagination.has_prev}
                  onPageChange={(page) => update({ page })}
                  onSizeChange={(size) => update({ size, page: 1 })}
                  isFetching={isFetching}
                />
              )}
            </>
          )}
        </>
      )}

      {!forbidden && openEntryId !== null && (
        <AuditEntryDetailModal
          key={openEntryId}
          entryId={openEntryId}
          placeholder={data?.items.find((item) => item.id === openEntryId)}
          onClose={() => setEntry(null)}
          onFilterRequest={(requestId) =>
            setSearchParams((previous) => {
              const next = writeAuditSearch(previous, {
                filters: { request_id: requestId },
                page: 1,
                size: state.size,
              })
              next.delete(AUDIT_ENTRY_PARAM)
              return next
            })
          }
        />
      )}
    </div>
  )
}
