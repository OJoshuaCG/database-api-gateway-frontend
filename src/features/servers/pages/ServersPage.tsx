import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import type { ServerOut } from '@/lib/contracts'
import { useServers } from '../hooks/use-servers'
import { useDeleteServer } from '../hooks/use-server-mutations'
import { ServerStatusBadge } from '../components/ServerStatusBadge'
import { ServerFormModal } from '../components/ServerFormModal'

export function ServersPage() {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ServerOut | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<ServerOut | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = useServers({ page, size })
  const deleteServer = useDeleteServer()

  const columns = useMemo<ColumnDef<ServerOut>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Nombre',
        cell: ({ row }) => (
          <Link
            to={`/servers/${row.original.id}`}
            className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'host',
        header: 'Host',
        accessorFn: (row) => `${row.host}:${row.port}`,
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'engine',
        header: 'Motor',
        cell: ({ getValue }) => <Badge tone="info">{getValue<string>()}</Badge>,
      },
      {
        accessorKey: 'status',
        header: 'Estado',
        cell: ({ row }) => <ServerStatusBadge status={row.original.status} />,
      },
      {
        id: 'ssl',
        header: 'TLS',
        accessorFn: (row) => (row.ssl_mode && row.ssl_mode.length > 0 ? row.ssl_mode : 'sin TLS'),
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'created_at',
        header: 'Creado',
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{formatDateTime(getValue<string>())}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(row.original)
                setFormOpen(true)
              }}
            >
              Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(row.original)}>
              Eliminar
            </Button>
          </div>
        ),
      },
    ],
    [],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Servidores"
        description="Inventario de servidores destino (MySQL, MariaDB, PostgreSQL)."
        actions={
          <Button
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            Registrar servidor
          </Button>
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            isLoading={isLoading}
            isFetching={isFetching}
            searchPlaceholder="Buscar servidor…"
            enableColumnVisibility
            emptyState={
              <EmptyState
                title="Aún no hay servidores"
                description="Registra tu primer servidor destino para empezar a gestionarlo."
                action={
                  <Button
                    onClick={() => {
                      setEditing(undefined)
                      setFormOpen(true)
                    }}
                  >
                    Registrar servidor
                  </Button>
                }
              />
            }
          />
          {data && data.items.length > 0 && (
            <Pagination
              page={data.pagination.page}
              pages={data.pagination.pages}
              total={data.pagination.total}
              size={data.pagination.size}
              hasNext={data.pagination.has_next}
              hasPrev={data.pagination.has_prev}
              onPageChange={setPage}
              onSizeChange={(next) => {
                setSize(next)
                setPage(1)
              }}
              isFetching={isFetching}
            />
          )}
        </>
      )}

      <ServerFormModal open={formOpen} onClose={() => setFormOpen(false)} server={editing} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return
          deleteServer.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
        }}
        title="Eliminar servidor del inventario"
        description={`Se eliminará «${deleteTarget?.name}» del inventario del gateway. Los objetos del motor destino no se modifican.`}
        confirmLabel="Eliminar"
        isLoading={deleteServer.isPending}
      />
    </div>
  )
}
