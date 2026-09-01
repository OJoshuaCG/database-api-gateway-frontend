import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge, DataTable, EmptyState, ErrorState, Pagination } from '@/components/ui'
import { formatDateTime, formatDuration, formatRelative } from '@/lib/utils/format'
import type { CloneBatchOut } from '@/lib/contracts'
import { CLONE_BATCH_TERMINAL_STATUSES } from '@/lib/contracts'
import { useCloneBatchList } from '@/features/clone-batches/hooks/use-clone-batches'
import {
  batchStatusLabel,
  batchStatusTone,
  completedCount,
} from '@/features/clone-batches/wizard/logic'

/**
 * Pestaña «Lotes» del historial.
 *
 * `GET /database-clone-batches` existía en el backend desde que se entregó el lote y **nadie lo
 * llamaba** (estaba marcado ⬜ en `docs/api-coverage.md`). Era el caso más grave de la
 * inalcanzabilidad: un lote corre sus bases en serie durante mucho tiempo, así que es la
 * operación donde más probable es irse de la vista.
 */
export function CloneBatchHistoryTab() {
  const [page, setPage] = useState(1)
  const params = useMemo(() => ({ page, size: 20 }), [page])

  const previo = useCloneBatchList(params)
  const hayEnCurso = (previo.data?.items ?? []).some(
    (row) => !CLONE_BATCH_TERMINAL_STATUSES.has(row.status),
  )
  const lista = useCloneBatchList(params, true, hayEnCurso)

  const columns = useMemo<ColumnDef<CloneBatchOut>[]>(
    () => [
      {
        id: 'estado',
        header: 'Estado',
        cell: ({ row }) => (
          <Badge tone={batchStatusTone(row.original.status)}>
            {batchStatusLabel(row.original.status)}
          </Badge>
        ),
      },
      {
        id: 'lote',
        header: 'Lote',
        cell: ({ row }) => (
          <span className="text-sm text-foreground">
            #{row.original.id} · {row.original.total} bases
          </span>
        ),
      },
      {
        id: 'avance',
        header: 'Avance',
        // `counts` viene derivado en vivo del servidor: se renderiza tal cual, no se re-suma acá.
        cell: ({ row }) => (
          <span className="text-sm text-foreground">
            {completedCount(row.original.counts)} de {row.original.total}
          </span>
        ),
      },
      {
        id: 'duracion',
        header: 'Duración',
        cell: ({ row }) => {
          const { started_at: inicio, finished_at: fin } = row.original
          const ms =
            inicio && fin ? new Date(fin).getTime() - new Date(inicio).getTime() : null
          return (
            <span className="text-sm text-foreground">
              {ms != null ? formatDuration(ms) : '—'}
            </span>
          )
        },
      },
      {
        id: 'cuando',
        header: 'Cuándo',
        cell: ({ row }) => (
          <span
            className="text-sm text-muted-foreground"
            title={formatDateTime(row.original.created_at)}
          >
            {formatRelative(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'acciones',
        header: '',
        cell: ({ row }) => (
          <Link
            to={`/database-clones/lotes/${row.original.id}`}
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            Ver
          </Link>
        ),
      },
    ],
    [],
  )

  if (lista.isError && !lista.data) {
    return <ErrorState error={lista.error} title="No se pudo cargar el historial de lotes" />
  }

  return (
    <div className="flex flex-col gap-4">
      <DataTable<CloneBatchOut>
        data={lista.data?.items ?? []}
        columns={columns}
        isLoading={lista.isLoading}
        isFetching={lista.isFetching}
        enableGlobalFilter={false}
        getRowId={(row) => String(row.id)}
        emptyState={
          <EmptyState
            title="Todavía no hay lotes"
            description="Un lote copia varias bases de un servidor a otro con una sola confirmación, de a una por vez."
          />
        }
      />
      {lista.data && lista.data.pagination.pages > 1 && (
        <Pagination
          page={lista.data.pagination.page}
          pages={lista.data.pagination.pages}
          total={lista.data.pagination.total}
          size={lista.data.pagination.size}
          hasNext={lista.data.pagination.has_next}
          hasPrev={lista.data.pagination.has_prev}
          onPageChange={setPage}
          isFetching={lista.isFetching}
        />
      )}
    </div>
  )
}
