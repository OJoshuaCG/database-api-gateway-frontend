import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
  PencilIcon,
  ListRemoveIcon,
  RowActionButton,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import { serverUserPath } from '@/lib/routes'
import type { ServerOut, ServerUserOut } from '@/lib/contracts'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useServerUsers } from '../hooks/use-server-users'
import { ServerUserFormModal } from '../components/ServerUserFormModal'
import { DeleteServerUserDialog } from '../components/DeleteServerUserDialog'
import { OwnedDatabasesModal } from '../components/OwnedDatabasesModal'

/**
 * Listado del INVENTARIO de usuarios, no del motor: por eso no ofrece «Revelar contraseña» ni las
 * acciones que ejecutan sobre el motor, que viven en la ficha (`ServerUserDetailPage`) y en la
 * tabla del servidor. Todo lo que sí ofrece cada fila —permisos, BDs, editar, quitar del
 * inventario— existe también en la ficha (R1), adonde lleva el nombre.
 *
 * Sus botones se arman aquí y no con `engine-user-actions`, a propósito y por ahora: esa lógica
 * decide por el estado de la identidad FRENTE AL MOTOR (`adopted`/`unmanaged`/`orphan`), que este
 * listado no conoce —`GET /server-users` devuelve el registro, no el cruce—, y la tabla del motor,
 * a la inversa, no tiene el registro. Se podrán unificar cuando una de las dos respuestas traiga lo
 * que le falta a la otra: el estado frente al motor aquí, o el registro allí.
 */
export function ServerUsersPage() {
  const navigate = useNavigate()
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
          <Link
            to={serverUserPath(row.original.server_id, row.original.username, row.original.host)}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {row.original.username}
            {row.original.host ? (
              <span className="text-muted-foreground">@{row.original.host}</span>
            ) : null}
          </Link>
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
        cell: ({ row }) => {
          const subject = row.original.host
            ? `${row.original.username}@${row.original.host}`
            : row.original.username
          return (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <RowActionButton
                label="Permisos efectivos"
                subject={subject}
                onClick={() =>
                  navigate(
                    serverUserPath(
                      row.original.server_id,
                      row.original.username,
                      row.original.host,
                      'grants',
                    ),
                  )
                }
              />
              <RowActionButton
                label="Ver BDs"
                subject={subject}
                onClick={() => setOwnedTarget(row.original)}
              />
              <RowActionButton
                label="Editar"
                subject={subject}
                icon={<PencilIcon />}
                onClick={() => {
                  setEditing(row.original)
                  setFormOpen(true)
                }}
              />
              {/* Por defecto solo borra el registro del gateway (el DROP es opt-in dentro del
                  diálogo), así que se nombra por esa consecuencia (R5) y lleva el MISMO icono que
                  «Quitar del inventario» en las bases: la papelera queda reservada para lo que
                  borra del motor, y así el icono solo ya distingue las dos consecuencias. En la
                  tarjeta lleva además su texto: no es un icono universal y ahí no hay tooltip. */}
              <RowActionButton
                label="Quitar del inventario"
                subject={subject}
                icon={<ListRemoveIcon />}
                iconText="card"
                variant="danger-soft"
                className="ml-2"
                onClick={() => setDeleteTarget(row.original)}
              />
            </div>
          )
        },
      },
    ],
    [navigate, serverNameById],
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
                description="Creá un usuario del motor para poder asignarle bases de datos."
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
