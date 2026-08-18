import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  AdoptionBadge,
  Button,
  CloneIcon,
  Combobox,
  CompareIcon,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  Pagination,
  PencilIcon,
  ShortcutBadge,
  TrashIcon,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import {
  provisionStatusSchema,
  type ManagedDatabaseOut,
  type ProvisionStatus,
  type ServerOut,
  type ServerUserOut,
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
  // Filtro por propietario: solo tiene sentido con un servidor elegido (los owners son por server).
  const [ownerFilter, setOwnerFilter] = useState<ServerUserOut | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ManagedDatabaseOut | undefined>(undefined)
  const [reassignTarget, setReassignTarget] = useState<ManagedDatabaseOut | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ManagedDatabaseOut | null>(null)

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
    owner_id: ownerFilter?.id,
  })

  const columns = useMemo<ColumnDef<ManagedDatabaseOut>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Nombre',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {/* Ficha unificada de la BD (grantees, resumen, migraciones, collation, comparar,
                clonar): identidad física `(server_id, nombre)`, no el id de inventario. */}
            <Link
              to={`/servers/${row.original.server_id}/databases/${encodeURIComponent(row.original.name)}`}
              className="font-medium text-foreground hover:text-primary hover:underline"
            >
              {row.original.name}
            </Link>
            {row.original.origin === 'adopted' && (
              <AdoptionBadge status="adopted" className="shrink-0" />
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
          <div className="flex items-center justify-end gap-1">
            {/* Comparar/Clonar/Migraciones/Reasignar duplican lo que la ficha unificada de la BD
                también ofrece: se conservan como atajo para operarios avanzados (decisión de
                producto), pero se agrupan aparte y se marcan con el badge para distinguirlos de
                las acciones propias de este listado (Editar/Eliminar). */}
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
              <ShortcutBadge title="Atajo — también disponible en la ficha completa de la base de datos." />
              {/* Solo el icono, el mismo que su entrada del menú lateral: el botón de fila y la
                  sección a la que lleva se reconocen como lo mismo, y la fila deja de alargarse
                  con dos etiquetas que se repiten en cada BD. El nombre sigue en el tooltip. */}
              <IconButton
                label="Comparar esquema"
                icon={<CompareIcon />}
                onClick={() => navigate(`/schema-comparisons?targetDatabaseId=${row.original.id}`)}
              />
              <IconButton
                label="Clonar"
                icon={<CloneIcon />}
                onClick={() => navigate(`/database-clones?sourceDatabaseId=${row.original.id}`)}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/managed-databases/${row.original.id}/migrations`)}
              >
                Migraciones
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setReassignTarget(row.original)}>
                Reasignar
              </Button>
            </div>
            <div className="mx-1 h-5 w-px bg-border" />
            <IconButton
              label="Editar"
              icon={<PencilIcon />}
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setEditing(row.original)
                setFormOpen(true)
              }}
            />
            <IconButton
              label="Eliminar"
              icon={<TrashIcon />}
              variant="danger-soft"
              size="icon-sm"
              onClick={() => setDeleteTarget(row.original)}
            />
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
              <CompareIcon />
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
              <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-auto lg:min-w-[48rem] lg:grid-cols-4">
                <Combobox<ServerOut>
                  items={servers.data ?? []}
                  value={serverFilter}
                  onChange={(server) => {
                    setServerFilter(server)
                    // Los propietarios son por servidor: al cambiarlo, el filtro deja de aplicar.
                    setOwnerFilter(null)
                    resetPage()
                  }}
                  itemToString={(s) => s.name}
                  itemToKey={(s) => s.id}
                  label="Servidor"
                  placeholder="Todos"
                  clearable
                />
                <Combobox<ServerUserOut>
                  items={owners.data ?? []}
                  value={ownerFilter}
                  onChange={(owner) => {
                    setOwnerFilter(owner)
                    resetPage()
                  }}
                  itemToString={(u) => u.username}
                  itemToKey={(u) => u.id}
                  label="Propietario"
                  placeholder={serverFilter ? 'Todos' : 'Elige un servidor primero'}
                  disabled={!serverFilter}
                  isLoading={Boolean(serverFilter) && owners.isLoading}
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
    </div>
  )
}
