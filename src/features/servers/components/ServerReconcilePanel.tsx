import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AdoptionBadge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  RefreshIcon,
  Spinner,
  type AdoptionStatus,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import type { ReconcileState, ServerUserOut } from '@/lib/contracts'
import { serverDatabasePath, serverUserPath } from '@/lib/routes'
import { AdoptDatabaseModal } from '@/features/managed-databases/components/AdoptDatabaseModal'
import { AdoptUserModal } from '@/features/server-users/components/AdoptUserModal'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import { useReconcile } from '../hooks/use-reconcile'
import { useServer } from '../hooks/use-servers'
import { DefineKnownPasswordModal } from './DefineKnownPasswordModal'
import { SnapshotModal } from './SnapshotModal'

type SubTab = 'databases' | 'users'

/**
 * El vocabulario de la reconciliación (`managed`) traducido al de la insignia compartida
 * (`adopted`): son el mismo estado, y con un mapa propio esta pantalla volvía a tener sus propias
 * etiquetas, que es lo que `AdoptionBadge` existe para evitar.
 */
const ADOPTION_STATUS: Record<ReconcileState, AdoptionStatus> = {
  managed: 'adopted',
  unmanaged: 'unmanaged',
  orphan: 'orphan',
}

/**
 * Panel de reconciliación de un servidor (Plan 09 §2): cruza el motor en vivo con el inventario y
 * ofrece las acciones de adopción sobre lo `unmanaged`. Es el puente entre los dos planos.
 *
 * Cada nombre enlaza a su ficha, que es donde viven TODAS las acciones de la entidad (R1 de
 * `managed-databases/database-actions.ts`). Por eso aquí no se suman acciones sobre huérfanos:
 * la ficha de una base o de un usuario huérfano ya las ofrece.
 */
export function ServerReconcilePanel({ serverId }: { serverId: number }) {
  const navigate = useNavigate()
  const [subTab, setSubTab] = useState<SubTab>('databases')
  const [adoptDb, setAdoptDb] = useState<string | null>(null)
  const [adoptUser, setAdoptUser] = useState<{ username: string; host?: string | null } | null>(
    null,
  )
  const [snapshotDb, setSnapshotDb] = useState<string | null>(null)
  const [defineTarget, setDefineTarget] = useState<{
    username: string
    defaultHost?: string | null
  } | null>(null)

  const { data, isLoading, isError, error, refetch } = useReconcile(serverId)
  // Ya en caché: es la misma consulta con la que `ServerDetailPage` pinta su cabecera. Solo hace
  // falta el motor, para saber si «Definir contraseña» opera por host (PostgreSQL no tiene).
  const server = useServer(serverId)
  const supportsHosts = server.data ? server.data.engine !== 'postgresql' : true
  // `owner_id` → usuario, para mostrar el nombre del dueño. Comparte key con el listado de bases
  // del servidor y con el modal de adopción, así que suele estar en caché; si no resuelve (o el
  // dueño queda fuera de la página cargada), se muestra el id como antes.
  const owners = useServerUserOptions(serverId)
  const ownersById = useMemo(() => {
    const map = new Map<number, ServerUserOut>()
    for (const user of owners.data ?? []) map.set(user.id, user)
    return map
  }, [owners.data])

  const dbCounts = useMemo(() => countStates(data?.databases.map((d) => d.state) ?? []), [data])
  const userCounts = useMemo(() => countStates(data?.users.map((u) => u.state) ?? []), [data])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Reconciliando con el motor…
      </div>
    )
  }
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 border-b border-border" role="tablist">
          <SubTabButton active={subTab === 'databases'} onClick={() => setSubTab('databases')}>
            Bases de datos
          </SubTabButton>
          <SubTabButton active={subTab === 'users'} onClick={() => setSubTab('users')}>
            Usuarios
          </SubTabButton>
        </div>
        <IconButton
          label="Re-escanear"
          icon={<RefreshIcon />}
          variant="ghost"
          size="icon-sm"
          onClick={() => void refetch()}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {subTab === 'databases'
          ? `${dbCounts.managed} gestionada(s) · ${dbCounts.unmanaged} adoptable(s) · ${dbCounts.orphan} huérfana(s)`
          : `${userCounts.managed} gestionado(s) · ${userCounts.unmanaged} adoptable(s) · ${userCounts.orphan} huérfano(s)`}
      </p>

      {subTab === 'databases' ? (
        data.databases.length === 0 ? (
          <EmptyState title="Sin bases de datos" />
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Nombre</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2 font-semibold">Dueño</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.databases.map((db) => (
                  <tr key={db.name} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      {/* También las huérfanas: su ficha distingue «sin aprovisionar» de
                          «existía y desapareció» y ofrece la salida de cada caso. */}
                      <Link
                        to={serverDatabasePath(serverId, db.name)}
                        className="font-medium text-primary hover:underline"
                      >
                        {db.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <AdoptionBadge status={ADOPTION_STATUS[db.state]} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <OwnerCell ownerId={db.owner_id} owners={ownersById} serverId={serverId} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => setSnapshotDb(db.name)}>
                          Ver snapshot
                        </Button>
                        {db.state !== 'orphan' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              navigate(
                                `/database-models/from-snapshot?serverId=${serverId}&database=${encodeURIComponent(
                                  db.name,
                                )}`,
                              )
                            }
                            title="Abre el asistente para elegir qué objetos y datos capturar"
                          >
                            Crear blueprint
                          </Button>
                        )}
                        {db.state === 'unmanaged' && (
                          <Button variant="outline" size="sm" onClick={() => setAdoptDb(db.name)}>
                            Adoptar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : data.users.length === 0 ? (
        <EmptyState title="Sin usuarios" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Usuario</th>
                <th className="px-3 py-2 font-semibold">Host</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr
                  key={`${user.username}@${user.host ?? ''}`}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-3 py-2">
                    <Link
                      to={serverUserPath(serverId, user.username, user.host)}
                      className="font-medium text-primary hover:underline"
                    >
                      {user.username}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{user.host ?? '—'}</td>
                  <td className="px-3 py-2">
                    <AdoptionBadge status={ADOPTION_STATUS[user.state]} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      {user.state === 'unmanaged' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAdoptUser({ username: user.username, host: user.host })}
                        >
                          Adoptar usuario
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adoptDb && (
        <AdoptDatabaseModal
          open
          onClose={() => setAdoptDb(null)}
          serverId={serverId}
          databaseName={adoptDb}
        />
      )}
      {adoptUser && (
        <AdoptUserModal
          open
          onClose={() => setAdoptUser(null)}
          serverId={serverId}
          username={adoptUser.username}
          host={adoptUser.host}
          onDefinePassword={() => {
            // La identidad nace sin contraseña: encadena con «Definir contraseña conocida», igual
            // que `EngineUsersPanel`.
            setDefineTarget({ username: adoptUser.username, defaultHost: adoptUser.host })
            setAdoptUser(null)
          }}
        />
      )}
      {defineTarget && (
        <DefineKnownPasswordModal
          onClose={() => setDefineTarget(null)}
          serverId={serverId}
          username={defineTarget.username}
          supportsHosts={supportsHosts}
          hostOptions={data.users
            .filter((user) => user.username === defineTarget.username && user.state !== 'orphan')
            .map((user) => user.host)
            .filter((host): host is string => Boolean(host))}
          defaultHost={defineTarget.defaultHost}
        />
      )}
      <SnapshotModal
        serverId={serverId}
        database={snapshotDb}
        onClose={() => setSnapshotDb(null)}
      />
    </div>
  )
}

/** Dueño de una base: su nombre si el usuario está resuelto, su id si no. */
function OwnerCell({
  ownerId,
  owners,
  serverId,
}: {
  ownerId: number | null | undefined
  owners: Map<number, ServerUserOut>
  serverId: number
}) {
  if (ownerId == null) return <>—</>
  const user = owners.get(ownerId)
  if (!user) return <>#{ownerId}</>
  return (
    <Link to={serverUserPath(serverId, user.username, user.host)} className="hover:underline">
      {user.host ? `${user.username}@${user.host}` : user.username}
    </Link>
  )
}

function countStates(states: ReconcileState[]) {
  return states.reduce(
    (acc, state) => {
      acc[state] += 1
      return acc
    },
    { managed: 0, unmanaged: 0, orphan: 0 } as Record<ReconcileState, number>,
  )
}

/**
 * Variante "sub-pestaña" del patrón compartido (`components/ui/TabButton`): padding más chico y
 * anidada bajo la pestaña principal de reconciliación, por lo que necesita marcar un nivel
 * jerárquico distinto al del `TabButton` de nivel superior. Es una diferencia deliberada, no
 * drift accidental — no fusionar sin resolver primero esa jerarquía visual.
 */
function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
