import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  RefreshIcon,
  Spinner,
  TrashIcon,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import type { ServerOut } from '@/lib/contracts'
import { ProvisionStatusBadge } from '@/features/managed-databases/components/ProvisionStatusBadge'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import { useServerDatabases } from '../hooks/use-server-databases'
import { filterDatabaseRows, type InventoryScope, type ServerDatabaseRow } from '../logic'
import { CreateServerDatabaseModal } from './CreateServerDatabaseModal'
import { ServerDatabaseDetailModal } from './ServerDatabaseDetailModal'
import { DropDatabaseDialog } from './DropDatabaseDialog'

const SCOPES: { id: InventoryScope; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'managed', label: 'Gestionadas' },
  { id: 'unmanaged', label: 'No gestionadas' },
]

/**
 * Vista 1 — bases de datos que existen FÍSICAMENTE en el servidor, cruzadas con el inventario
 * del gateway (docs del backend: server-database-lifecycle).
 *
 * Se comporta como el explorador físico del motor, no como una vista del inventario: la
 * identidad de cada fila es `(server_id, nombre)`, y la insignia de inventario es información
 * cruzada, no la fuente de la lista. Por eso el listado físico manda y su fallo es el único
 * que vacía la tabla.
 *
 * Sin selección múltiple a propósito (§6.6): cada borrado exige su propio `confirm_token`
 * ligado a su base, y un borrado en lote es justo el patrón que la doble confirmación evita.
 */
export function ServerDatabasesPanel({
  server,
  onGoToReconcile,
}: {
  server: ServerOut
  onGoToReconcile?: () => void
}) {
  const serverId = server.id
  const { rows, physical, inventory, inventoryTruncated, refetch } = useServerDatabases(serverId)

  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<InventoryScope>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState<ServerDatabaseRow | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  // Resuelve `owner_id` → username. Es una consulta ya cacheada por otros módulos y degrada
  // sola: si el propietario no está en la página cargada, se muestra su id.
  const owners = useServerUserOptions(serverId)
  const ownerNames = useMemo(() => {
    const map = new Map<number, string>()
    for (const user of owners.data ?? []) {
      map.set(user.id, user.host ? `${user.username}@${user.host}` : user.username)
    }
    return map
  }, [owners.data])

  const visibleRows = useMemo(
    () => filterDatabaseRows(rows, { search, scope }),
    [rows, search, scope],
  )

  const columns = useMemo<ColumnDef<ServerDatabaseRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Nombre',
        accessorFn: (row) => row.name,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setDetailTarget(row.original)}
            className="font-mono text-sm text-primary hover:underline"
          >
            {row.original.name}
          </button>
        ),
      },
      {
        id: 'inventory',
        header: 'Inventario',
        accessorFn: (row) => (row.isManaged ? 'gestionada' : 'no gestionada'),
        cell: ({ row }) =>
          // Mientras el inventario no haya resuelto, el cruce es indeterminado: decir
          // "No gestionada" sería afirmar algo que todavía no se sabe.
          inventory.isPending ? (
            <span className="text-xs text-muted-foreground">…</span>
          ) : row.original.isManaged ? (
            <Link to="/managed-databases" className="hover:underline">
              <Badge tone="success">Gestionada</Badge>
            </Link>
          ) : (
            <Badge tone="warning">No gestionada</Badge>
          ),
      },
      {
        id: 'owner',
        header: 'Propietario',
        accessorFn: (row) => row.managed?.owner_id ?? '',
        cell: ({ row }) => {
          const ownerId = row.original.managed?.owner_id
          if (ownerId === undefined) return <span className="text-muted-foreground">—</span>
          return (
            <span className="font-mono text-xs">{ownerNames.get(ownerId) ?? `#${ownerId}`}</span>
          )
        },
      },
      {
        id: 'status',
        header: 'Estado',
        accessorFn: (row) => row.managed?.status ?? '',
        cell: ({ row }) =>
          row.original.managed ? (
            <ProvisionStatusBadge status={row.original.managed.status} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'actions',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDetailTarget(row.original)}>
              Ver usuarios
            </Button>
            {!row.original.isManaged && (
              <Link to="/managed-databases">
                <Button variant="ghost" size="sm">
                  Adoptar
                </Button>
              </Link>
            )}
            <IconButton
              label="Eliminar"
              icon={<TrashIcon />}
              variant="danger-soft"
              size="icon-sm"
              onClick={() => setDropTarget(row.original.name)}
            />
          </div>
        ),
      },
    ],
    [inventory.isPending, ownerNames],
  )

  if (physical.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando bases de datos del servidor…
      </div>
    )
  }
  // Solo el listado físico es bloqueante: sin él no hay nada que mostrar.
  if (physical.isError) return <ErrorState error={physical.error} onRetry={() => refetch()} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {visibleRows.length === rows.length
            ? `${rows.length} base(s) de datos`
            : `${visibleRows.length} de ${rows.length} base(s) de datos`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setCreateOpen(true)}>Nueva base de datos 🔌</Button>
          <IconButton
            label="Actualizar"
            icon={<RefreshIcon />}
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            isLoading={physical.isFetching}
          />
          {onGoToReconcile && (
            <Button variant="ghost" onClick={onGoToReconcile}>
              Ver reconciliación del servidor →
            </Button>
          )}
        </div>
      </div>

      {/* Aviso de contexto permanente: esta vista NO es el inventario. */}
      <p className="rounded-card border border-border bg-surface-muted px-4 py-3 text-sm text-muted-foreground">
        Esta vista muestra las bases de datos que <strong>existen en el motor</strong>. Las bases de
        datos del sistema no se listan y no pueden crearse ni borrarse desde aquí.
      </p>

      {/* Fallo parcial: la tabla sigue siendo útil sin el cruce, pero hay que decirlo. */}
      {inventory.isError && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3">
          {/* El reintento sale del párrafo: un icono a mitad de frase cortaría la lectura. */}
          <p className="min-w-0 flex-1 text-sm text-warning">
            No se pudo cargar el cruce con el inventario: la columna «Inventario» puede no ser
            fiable.
          </p>
          <IconButton
            label="Reintentar"
            icon={<RefreshIcon />}
            variant="ghost"
            size="icon-sm"
            onClick={() => void inventory.refetch()}
          />
        </div>
      )}
      {inventoryTruncated && (
        <p className="rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          El inventario de este servidor tiene más registros de los que se cargaron: alguna base
          podría aparecer como «No gestionada» sin serlo.
        </p>
      )}

      <DataTable
        data={visibleRows}
        columns={columns}
        isFetching={physical.isFetching}
        enableGlobalFilter={false}
        clientPageSize={25}
        getRowId={(row) => row.name}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar base de datos…"
              aria-label="Buscar base de datos"
              className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <div className="flex gap-1" role="group" aria-label="Filtrar por inventario">
              {SCOPES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setScope(option.id)}
                  aria-pressed={scope === option.id}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm',
                    scope === option.id
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        }
        emptyState={
          <EmptyState
            title="Este servidor no tiene bases de datos de usuario."
            description="Las bases de datos del sistema del motor no se muestran."
            action={
              <Button onClick={() => setCreateOpen(true)}>Crear la primera base de datos 🔌</Button>
            }
          />
        }
      />

      <CreateServerDatabaseModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        serverId={serverId}
        serverName={server.name}
        engine={server.engine}
        existingNames={physical.data ?? []}
      />

      {/* Montaje condicional: cada apertura nace con estado fresco, sin resetear por efectos. */}
      {detailTarget && (
        <ServerDatabaseDetailModal
          open
          onClose={() => setDetailTarget(null)}
          serverId={serverId}
          engine={server.engine}
          row={detailTarget}
          onRequestDelete={() => {
            setDropTarget(detailTarget.name)
            setDetailTarget(null)
          }}
        />
      )}

      {dropTarget && (
        <DropDatabaseDialog
          serverId={serverId}
          serverName={server.name}
          serverEndpoint={`${server.host}:${server.port}`}
          engine={server.engine}
          database={dropTarget}
          onClose={() => setDropTarget(null)}
          onDeleted={() => {
            setDropTarget(null)
            refetch()
          }}
          onShowGrantees={() => {
            const row = rows.find((candidate) => candidate.name === dropTarget)
            if (!row) return
            setDropTarget(null)
            setDetailTarget(row)
          }}
        />
      )}
    </div>
  )
}
