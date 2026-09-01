import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  Combobox,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
} from '@/components/ui'
import { formatDateTime, formatDuration, formatRelative } from '@/lib/utils/format'
import type { CloneListItemOut, CloneStatus, ServerOut } from '@/lib/contracts'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useDatabaseCloneList, CLONE_TERMINAL_STATUSES } from '../hooks/use-database-clones'
import { CLONE_STATUS_LABELS, CLONE_STATUS_TONES, COPY_INTENT_LABELS } from '../logic/labels'

/**
 * Pestaña «Individuales» del historial. Es el punto de reentrada del módulo: sin ella, un clon
 * cuyo id se perdió del estado del navegador quedaba inalcanzable.
 *
 * Paginación y filtros SERVER-SIDE (`DataTable` solo pinta el cuerpo). Por eso
 * `enableGlobalFilter` va en `false`: la búsqueda de `DataTable` filtra la página cargada, y
 * dejar dos búsquedas visibles —una que filtra 20 filas y otra el conjunto— es una trampa.
 */
const ESTADOS: CloneStatus[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'interrupted',
  'canceled',
]

export function CloneHistoryTab() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<CloneStatus | null>(null)
  const [targetServer, setTargetServer] = useState<ServerOut | null>(null)
  const [search, setSearch] = useState('')
  const [incluirHijos, setIncluirHijos] = useState(false)

  const serverOptions = useServerOptions()

  const params = useMemo(
    () => ({
      page,
      size: 20,
      ...(status ? { status } : {}),
      ...(targetServer ? { target_server_id: targetServer.id } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
      include_batch_children: incluirHijos,
    }),
    [page, status, targetServer, search, incluirHijos],
  )

  const filtrando = status != null || targetServer != null || search.trim().length > 0

  // El polling lo decide el CONTENIDO de la página visible: si no hay ninguna fila en curso,
  // no hay nada que refrescar y un intervalo fijo dejaría el historial consultando para siempre.
  const previo = useDatabaseCloneList(params, false)
  const hayEnCurso = (previo.data?.items ?? []).some(
    (row) => !CLONE_TERMINAL_STATUSES.has(row.status),
  )
  const lista = useDatabaseCloneList(params, hayEnCurso)

  const columns = useMemo<ColumnDef<CloneListItemOut>[]>(
    () => [
      {
        id: 'estado',
        header: 'Estado',
        cell: ({ row }) => (
          <Badge tone={CLONE_STATUS_TONES[row.original.status]}>
            {CLONE_STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
      {
        id: 'bases',
        header: 'Origen → Destino',
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="break-all text-sm text-foreground">
              {row.original.source_database_name}{' '}
              <span className="text-muted-foreground">→</span>{' '}
              {row.original.target_database_name}
            </span>
            {row.original.batch_id != null && (
              <Link
                to={`/database-clones/lotes/${row.original.batch_id}`}
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                fila {row.original.batch_seq} del lote #{row.original.batch_id}
              </Link>
            )}
          </div>
        ),
      },
      {
        id: 'copia',
        header: 'Copia',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {COPY_INTENT_LABELS[row.original.copy_intent ?? 'structure_only']}
          </span>
        ),
      },
      {
        id: 'duracion',
        header: 'Duración',
        cell: ({ row }) => (
          <span className="text-sm text-foreground">
            {row.original.duration_ms != null ? formatDuration(row.original.duration_ms) : '—'}
          </span>
        ),
      },
      {
        id: 'cuando',
        header: 'Cuándo',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground" title={formatDateTime(row.original.created_at)}>
            {formatRelative(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'acciones',
        header: '',
        cell: ({ row }) => (
          <Link
            to={`/database-clones/${row.original.id}`}
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
    return <ErrorState error={lista.error} title="No se pudo cargar el historial de clonaciones" />
  }

  return (
    <div className="flex flex-col gap-4">
      <DataTable<CloneListItemOut>
        data={lista.data?.items ?? []}
        columns={columns}
        isLoading={lista.isLoading}
        isFetching={lista.isFetching}
        enableGlobalFilter={false}
        getRowId={(row) => String(row.id)}
        toolbar={
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Input
                label="Buscar"
                placeholder="Nombre de base, origen o destino"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div className="min-w-44">
              <Combobox<CloneStatus>
                label="Estado"
                items={ESTADOS}
                value={status}
                onChange={(value) => {
                  setStatus(value)
                  setPage(1)
                }}
                itemToString={(value) => (value ? CLONE_STATUS_LABELS[value] : '')}
                itemToKey={(value) => value}
                placeholder="Todos"
              />
            </div>
            <div className="min-w-48">
              <Combobox<ServerOut>
                label="Servidor destino"
                items={serverOptions.data ?? []}
                value={targetServer}
                onChange={(value) => {
                  setTargetServer(value)
                  setPage(1)
                }}
                itemToString={(server) => server?.name ?? ''}
                itemToKey={(server) => String(server.id)}
                placeholder="Todos"
              />
            </div>
            <Button
              variant={incluirHijos ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={incluirHijos}
              onClick={() => {
                setIncluirHijos((prev) => !prev)
                setPage(1)
              }}
            >
              Incluir las de un lote
            </Button>
          </div>
        }
        emptyState={
          // Dos vacíos distintos: decir «todavía no hay clonaciones» con un filtro puesto es
          // mentira, y hace pensar que se perdieron.
          filtrando ? (
            <EmptyState
              title="Ninguna clonación coincide con los filtros"
              description="Probá con otro estado, otro servidor o limpiando la búsqueda."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setStatus(null)
                    setTargetServer(null)
                    setSearch('')
                    setPage(1)
                  }}
                >
                  Quitar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Todavía no hay clonaciones"
              description="Cuando clones una base, la operación queda registrada acá con su duración y su detalle, incluso si cerrás la pestaña."
            />
          )
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
