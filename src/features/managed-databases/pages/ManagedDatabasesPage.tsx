import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  Combobox,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import {
  provisionStatusSchema,
  type ManagedDatabaseOut,
  type ProvisionStatus,
  type ServerOut,
  type DatabaseModelOut,
} from '@/lib/contracts'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import { useDatabaseModelOptions } from '@/features/database-models/hooks/use-database-model-options'
import { useManagedDatabases } from '../hooks/use-managed-databases'
import { ProvisionStatusBadge } from '../components/ProvisionStatusBadge'
import { ManagedDatabaseFormModal } from '../components/ManagedDatabaseFormModal'
import { ReassignOwnerModal } from '../components/ReassignOwnerModal'
import { DeleteManagedDatabaseDialog } from '../components/DeleteManagedDatabaseDialog'
import { ManagedDatabaseMigrationsModal } from '../components/ManagedDatabaseMigrationsModal'

interface StatusOption {
  value: ProvisionStatus
  label: string
}

const STATUS_LABELS: Record<ProvisionStatus, string> = {
  pending: 'Pendiente',
  active: 'Activa',
  error: 'Error',
  archived: 'Archivada',
}

const STATUS_OPTIONS: StatusOption[] = provisionStatusSchema.options.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}))

export function ManagedDatabasesPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [serverFilter, setServerFilter] = useState<ServerOut | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusOption | null>(null)
  const [modelFilter, setModelFilter] = useState<DatabaseModelOut | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ManagedDatabaseOut | undefined>(undefined)
  const [reassignTarget, setReassignTarget] = useState<ManagedDatabaseOut | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ManagedDatabaseOut | null>(null)
  const [migrationsTarget, setMigrationsTarget] = useState<ManagedDatabaseOut | null>(null)

  const servers = useServerOptions()
  const models = useDatabaseModelOptions()
  const owners = useServerUserOptions(serverFilter?.id ?? null)

  const serverNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const server of servers.data ?? []) map.set(server.id, server.name)
    return map
  }, [servers.data])

  const ownerNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const owner of owners.data ?? []) map.set(owner.id, owner.username)
    return map
  }, [owners.data])

  const { data, isLoading, isFetching, isError, error, refetch } = useManagedDatabases({
    page,
    size,
    server_id: serverFilter?.id,
    status: statusFilter?.value,
    model_id: modelFilter?.id,
  })

  const columns = useMemo<ColumnDef<ManagedDatabaseOut>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Nombre',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{row.original.name}</span>
            {row.original.origin === 'adopted' && (
              <Badge tone="neutral" className="shrink-0">
                📥 adoptada
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: 'server',
        header: 'Servidor',
        accessorFn: (row) => serverNameById.get(row.server_id) ?? `#${row.server_id}`,
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        id: 'owner',
        header: 'Propietario',
        accessorFn: (row) => ownerNameById.get(row.owner_id) ?? `#${row.owner_id}`,
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'status',
        header: 'Estado',
        cell: ({ row }) => <ProvisionStatusBadge status={row.original.status} />,
      },
      {
        id: 'model_version',
        header: 'Modelo',
        accessorFn: (row) => row.model_version ?? '—',
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
              onClick={() => navigate(`/schema-comparisons?targetDatabaseId=${row.original.id}`)}
            >
              Comparar esquema
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/database-clones?sourceDatabaseId=${row.original.id}`)}
            >
              Clonar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMigrationsTarget(row.original)}>
              Migraciones
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setReassignTarget(row.original)}>
              Reasignar
            </Button>
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
    [serverNameById, ownerNameById],
  )

  const resetPage = () => setPage(1)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bases de datos"
        description="Bases de datos gestionadas en los servidores destino."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/schema-comparisons')}>
              Comparar esquemas
            </Button>
            <Button
              onClick={() => {
                setEditing(undefined)
                setFormOpen(true)
              }}
            >
              Crear base de datos
            </Button>
          </>
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
            searchPlaceholder="Buscar base de datos…"
            enableColumnVisibility
            toolbar={
              <div className="grid w-full gap-3 sm:grid-cols-3 lg:w-auto lg:min-w-[36rem]">
                <Combobox<ServerOut>
                  items={servers.data ?? []}
                  value={serverFilter}
                  onChange={(server) => {
                    setServerFilter(server)
                    resetPage()
                  }}
                  itemToString={(s) => s.name}
                  itemToKey={(s) => s.id}
                  label="Servidor"
                  placeholder="Todos"
                  clearable
                />
                <Combobox<StatusOption>
                  items={STATUS_OPTIONS}
                  value={statusFilter}
                  onChange={(option) => {
                    setStatusFilter(option)
                    resetPage()
                  }}
                  itemToString={(o) => o.label}
                  itemToKey={(o) => o.value}
                  label="Estado"
                  placeholder="Todos"
                  clearable
                />
                <Combobox<DatabaseModelOut>
                  items={models.data ?? []}
                  value={modelFilter}
                  onChange={(model) => {
                    setModelFilter(model)
                    resetPage()
                  }}
                  itemToString={(m) => m.name}
                  itemToKey={(m) => m.id}
                  label="Blueprint"
                  placeholder="Todos"
                  clearable
                />
              </div>
            }
            emptyState={
              <EmptyState
                title="No hay bases de datos"
                description="Crea una base de datos y, opcionalmente, aprovisiónala en el motor."
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
                resetPage()
              }}
              isFetching={isFetching}
            />
          )}
        </>
      )}

      <ManagedDatabaseFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        database={editing}
        defaultServerId={serverFilter?.id}
        serverName={editing ? serverNameById.get(editing.server_id) : undefined}
      />
      {reassignTarget && (
        <ReassignOwnerModal database={reassignTarget} onClose={() => setReassignTarget(null)} />
      )}
      {deleteTarget && (
        <DeleteManagedDatabaseDialog
          database={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      <ManagedDatabaseMigrationsModal
        key={migrationsTarget?.id ?? 'closed'}
        database={migrationsTarget}
        onClose={() => setMigrationsTarget(null)}
      />
    </div>
  )
}
