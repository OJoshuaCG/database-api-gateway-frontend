import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  AdoptionBadge,
  Button,
  DataTable,
  EmptyState,
  EnvironmentBadge,
  ErrorState,
  IconButton,
  RefreshIcon,
  Spinner,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { CAPABILITIES, type ServerOut, type ServerUserOut } from '@/lib/contracts'
import { CapabilityHint, useCapabilityGuard } from '@/features/auth'
import { serverDatabasePath, serverUserPath } from '@/lib/routes'
import { ProvisionStatusBadge } from '@/features/managed-databases/components/ProvisionStatusBadge'
import {
  DatabaseActionDialogs,
  DatabaseRowActions,
  type PendingDatabaseAction,
} from '@/features/managed-databases/components/DatabaseRowActions'
import { resolveDatabaseState } from '@/features/managed-databases/database-actions'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import { resolveEnvironmentState, useEnvironmentMap } from '@/features/environments'
import { useServerDatabases } from '../hooks/use-server-databases'
import { filterDatabaseRows, type InventoryScope, type ServerDatabaseRow } from '../logic'
import { CreateServerDatabaseModal } from './CreateServerDatabaseModal'

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
 *
 * Las acciones de cada fila son las de `DatabaseRowActions` con `source="physical"`: una base
 * gestionada tiene aquí las mismas que en el inventario (Editar, Reasignar, Migraciones…), salvo
 * la destructiva, que en este listado es «Eliminar del motor 🔌».
 */
export function ServerDatabasesPanel({
  server,
  onGoToReconcile,
}: {
  server: ServerOut
  onGoToReconcile?: () => void
}) {
  // `POST /servers/{id}/databases` → `databases.write` (rol unión: esa ruta no tiene capa 2).
  const createGuard = useCapabilityGuard(CAPABILITIES.databasesWrite, 'crear bases de datos')
  const serverId = server.id
  const navigate = useNavigate()
  const { rows, physical, inventory, inventoryTruncated, refetch } = useServerDatabases(serverId)

  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<InventoryScope>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingDatabaseAction | null>(null)

  // Resuelve `owner_id` → username. Es una consulta ya cacheada por otros módulos y degrada
  // sola: si el propietario no está en la página cargada, se muestra su id.
  const owners = useServerUserOptions(serverId)
  const ownersById = useMemo(() => {
    const map = new Map<number, ServerUserOut>()
    for (const user of owners.data ?? []) map.set(user.id, user)
    return map
  }, [owners.data])

  const environmentMap = useEnvironmentMap()

  // Sin el inventario resuelto no se sabe si una base sin registro está gestionada: la fila se
  // queda en las acciones del motor en vez de ofrecer «Adoptar» sobre algo quizá ya adoptado.
  // Truncado cuenta como no resuelto: una base fuera de la primera página saldría «no gestionada».
  const inventoryKnown = inventory.isSuccess && !inventoryTruncated

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
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={serverDatabasePath(serverId, row.original.name)}
              className="font-mono text-sm text-primary hover:underline"
            >
              {row.original.name}
            </Link>
            {/* Junto al nombre, como en el inventario: esta fila tiene el «Eliminar del motor 🔌»,
                y el entorno es la etiqueta que dice «producción». Solo las gestionadas lo tienen. */}
            {row.original.managed && (
              <EnvironmentBadge
                state={resolveEnvironmentState(row.original.managed.environment_id, environmentMap)}
                className="shrink-0"
              />
            )}
          </div>
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
          ) : (
            // Sin enlace: llevaba a `/managed-databases` sin filtro, un listado donde había que
            // volver a buscar la base. Su ficha ya está en el nombre.
            <AdoptionBadge status={row.original.isManaged ? 'adopted' : 'unmanaged'} />
          ),
      },
      {
        id: 'owner',
        header: 'Propietario',
        accessorFn: (row) => row.managed?.owner_id ?? '',
        cell: ({ row }) => {
          const ownerId = row.original.managed?.owner_id
          if (ownerId === undefined) return <span className="text-muted-foreground">—</span>
          const owner = ownersById.get(ownerId)
          // Si el propietario no está en la página cargada de usuarios, queda su id sin enlace.
          if (!owner) return <span className="font-mono text-xs">#{ownerId}</span>
          return (
            <Link
              to={serverUserPath(serverId, owner.username, owner.host)}
              className="font-mono text-xs text-primary hover:underline"
            >
              {owner.host ? `${owner.username}@${owner.host}` : owner.username}
            </Link>
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
        header: '',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <DatabaseRowActions
            source="physical"
            target={{
              serverId,
              name: row.original.name,
              managed: row.original.managed,
              state: resolveDatabaseState({
                managed: row.original.managed,
                inventoryKnown,
                presence: 'present',
              }),
            }}
            onAction={setPendingAction}
          />
        ),
      },
    ],
    [inventory.isPending, inventoryKnown, ownersById, serverId, environmentMap],
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
          <Button
            onClick={() => setCreateOpen(true)}
            disabled={!createGuard.allowed}
            aria-describedby={createGuard.describedBy}
          >
            Nueva base de datos 🔌
          </Button>
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
        <CapabilityHint guard={createGuard} className="basis-full text-right" />
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
          podría aparecer como «No adoptada» sin serlo. Por eso las bases sin registro no ofrecen
          «Adoptar» ni acciones de inventario (Editar, Reasignar, Migraciones, Comparar, Clonar).
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

      <DatabaseActionDialogs
        pending={pendingAction}
        getServer={(id) => (id === serverId ? server : undefined)}
        onClose={() => setPendingAction(null)}
        onDropped={() => refetch()}
        // Los grantees ya no viven en un modal hermano: son una pestaña de la ficha, así que
        // esta salida deja el borrado y navega a ella.
        onShowGrantees={(target) => void navigate(serverDatabasePath(serverId, target.name))}
      />
    </div>
  )
}
