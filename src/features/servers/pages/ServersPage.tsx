import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  Pagination,
  PencilIcon,
  TrashIcon,
} from '@/components/ui'
import { CapabilityCallout, useCapabilityGuard } from '@/features/auth'
import { formatDateTime } from '@/lib/utils'
import { CAPABILITIES, type ServerOut } from '@/lib/contracts'
import { useServers } from '../hooks/use-servers'
import { useTestConnection } from '../hooks/use-server-mutations'
import { ServerStatusBadge } from '../components/ServerStatusBadge'
import { ServerFormModal } from '../components/ServerFormModal'
import { DeleteServerDialog } from '../components/DeleteServerDialog'

/**
 * Inventario de servidores.
 *
 * **Las acciones de cada fila son atajos** (regla R1): la vista propia del servidor es su
 * detalle (`ServerDetailPage`), que tiene todas; acá se reusan los mismos componentes
 * (`ServerFormModal`, `DeleteServerDialog`) y el mismo hook de «Probar conexión». Una acción nueva
 * se agrega primero en el detalle; que exista solo en esta fila es el síntoma a evitar.
 */
export function ServersPage() {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ServerOut | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<ServerOut | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = useServers({ page, size })
  /*
   * Registrar, editar y dar de baja son `servers.admin`, que ni `owner` tiene (es de
   * `security_officer`): editar un servidor puede re-apuntar un `server_id` a otro host. Sin ella,
   * «Registrar servidor» va deshabilitado con el motivo y las filas esconden editar/eliminar, con
   * un único aviso sobre la tabla. «Probar conexión» queda: es `servers.read`.
   */
  const adminGuard = useCapabilityGuard(CAPABILITIES.serversAdmin, 'registrar servidores')
  const canAdmin = adminGuard.allowed
  // UN aviso para la pantalla: el botón de la cabecera lo referencia y las acciones de fila (que
  // se esconden) quedan explicadas ahí.
  const accessNoticeId = useId()

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
          <div className="flex justify-end gap-1">
            <TestConnectionButton serverId={row.original.id} />
            {canAdmin && (
              <>
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
              </>
            )}
          </div>
        ),
      },
    ],
    [canAdmin],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Servidores"
        description="Inventario de servidores destino (MySQL, MariaDB, PostgreSQL)."
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button
              disabled={!canAdmin}
              aria-describedby={canAdmin ? undefined : accessNoticeId}
              onClick={() => {
                setEditing(undefined)
                setFormOpen(true)
              }}
            >
              Registrar servidor
            </Button>
          </div>
        }
      />

      <CapabilityCallout
        id={accessNoticeId}
        canDo="ver y probar los servidores"
        cannotDo="registrarlos, editarlos ni darlos de baja"
        missing={adminGuard.missing}
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
                  canAdmin ? (
                    <Button
                      onClick={() => {
                        setEditing(undefined)
                        setFormOpen(true)
                      }}
                    >
                      Registrar servidor
                    </Button>
                  ) : undefined
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

      <DeleteServerDialog server={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  )
}

/**
 * Atajo de fila a «Probar conexión» 🔌. Es un componente y no un botón suelto en la celda porque
 * `useTestConnection` está parametrizado con el id, distinto en cada fila.
 *
 * El resultado se presenta con el toast que ya emite el hook —el mismo que ve el detalle— y con
 * la insignia de estado de la propia fila, que se refresca porque el hook invalida el listado.
 * El recuadro de resultado del detalle no se replica: en una tabla no tiene dónde vivir.
 */
function TestConnectionButton({ serverId }: { serverId: number }) {
  const testConnection = useTestConnection(serverId)
  return (
    <Button
      variant="ghost"
      size="sm"
      isLoading={testConnection.isPending}
      onClick={() => testConnection.mutate()}
    >
      Probar conexión
    </Button>
  )
}
