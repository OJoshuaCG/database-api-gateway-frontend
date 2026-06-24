import { useMemo, useState } from 'react'
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
import type { ServerOut, ServerUserOut } from '@/lib/contracts'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useServerUsers } from '../hooks/use-server-users'
import { ServerUserFormModal } from '../components/ServerUserFormModal'
import { DeleteServerUserDialog } from '../components/DeleteServerUserDialog'
import { OwnedDatabasesModal } from '../components/OwnedDatabasesModal'

export function ServerUsersPage() {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [serverFilter, setServerFilter] = useState<ServerOut | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ServerUserOut | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<ServerUserOut | null>(null)
  const [ownedTarget, setOwnedTarget] = useState<ServerUserOut | null>(null)

  const servers = useServerOptions()
  const serverNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const server of servers.data ?? []) map.set(server.id, server.name)
    return map
  }, [servers.data])

  const { data, isLoading, isFetching, isError, error, refetch } = useServerUsers({
    page,
    size,
    server_id: serverFilter?.id,
  })

  const columns = useMemo<ColumnDef<ServerUserOut>[]>(
    () => [
      {
        accessorKey: 'username',
        header: 'Usuario',
        cell: ({ row }) => (
          <span className="font-medium text-foreground">
            {row.original.username}
            {row.original.host ? (
              <span className="text-muted-foreground">@{row.original.host}</span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'server',
        header: 'Servidor',
        accessorFn: (row) => serverNameById.get(row.server_id) ?? `#${row.server_id}`,
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'is_active',
        header: 'Estado',
        cell: ({ row }) => (
          <Badge tone={row.original.is_active ? 'success' : 'neutral'}>
            {row.original.is_active ? 'Activo' : 'Inactivo'}
          </Badge>
        ),
      },
      {
        accessorKey: 'has_password',
        header: 'Contraseña',
        cell: ({ row }) => (
          <Badge tone={row.original.has_password ? 'success' : 'warning'}>
            {row.original.has_password ? 'Sí' : 'No'}
          </Badge>
        ),
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
            <Button variant="ghost" size="sm" onClick={() => setOwnedTarget(row.original)}>
              Ver BDs
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
    [serverNameById],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usuarios del motor"
        description="Usuarios/roles propietarios de bases de datos en los servidores destino."
        actions={
          <Button
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            Crear usuario
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
            searchPlaceholder="Buscar usuario…"
            enableColumnVisibility
            toolbar={
              <div className="w-full sm:max-w-xs">
                <Combobox<ServerOut>
                  items={servers.data ?? []}
                  value={serverFilter}
                  onChange={(server) => {
                    setServerFilter(server)
                    setPage(1)
                  }}
                  itemToString={(s) => s.name}
                  itemToKey={(s) => s.id}
                  label="Filtrar por servidor"
                  placeholder="Todos los servidores"
                  clearable
                />
              </div>
            }
            emptyState={
              <EmptyState
                title="No hay usuarios"
                description="Crea un usuario del motor para poder asignarle bases de datos."
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

      <ServerUserFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        user={editing}
        defaultServerId={serverFilter?.id}
        serverName={editing ? serverNameById.get(editing.server_id) : undefined}
      />
      {deleteTarget && (
        <DeleteServerUserDialog user={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
      <OwnedDatabasesModal user={ownedTarget} onClose={() => setOwnedTarget(null)} />
    </div>
  )
}
