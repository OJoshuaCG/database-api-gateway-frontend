import { useMemo, useState, type ReactNode } from 'react'
import { Badge, Button, EmptyState, ErrorState, Spinner } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { ReconcileState } from '@/lib/contracts'
import { AdoptDatabaseModal } from '@/features/managed-databases/components/AdoptDatabaseModal'
import { AdoptUserModal } from '@/features/server-users/components/AdoptUserModal'
import { useReconcile } from '../hooks/use-reconcile'
import { SnapshotModal } from './SnapshotModal'

type SubTab = 'databases' | 'users'

const STATE_BADGE: Record<ReconcileState, { tone: 'success' | 'warning' | 'error'; label: string }> =
  {
    managed: { tone: 'success', label: '🟢 Gestionada' },
    unmanaged: { tone: 'warning', label: '🟡 Sin gestionar' },
    orphan: { tone: 'error', label: '🔴 Huérfana' },
  }

/**
 * Panel de reconciliación de un servidor (Plan 09 §2): cruza el motor en vivo con el inventario y
 * ofrece las acciones de adopción sobre lo `unmanaged`. Es el puente entre los dos planos.
 */
export function ServerReconcilePanel({ serverId }: { serverId: number }) {
  const [subTab, setSubTab] = useState<SubTab>('databases')
  const [adoptDb, setAdoptDb] = useState<string | null>(null)
  const [adoptUser, setAdoptUser] = useState<{ username: string; host?: string | null } | null>(
    null,
  )
  const [snapshotDb, setSnapshotDb] = useState<string | null>(null)

  const { data, isLoading, isError, error, refetch } = useReconcile(serverId)

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
        <Button variant="ghost" size="sm" onClick={() => void refetch()}>
          Re-escanear
        </Button>
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
                    <td className="px-3 py-2 font-medium text-foreground">{db.name}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATE_BADGE[db.state].tone}>{STATE_BADGE[db.state].label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {db.owner_id ? `#${db.owner_id}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => setSnapshotDb(db.name)}>
                          Ver snapshot
                        </Button>
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
                <tr key={`${user.username}@${user.host ?? ''}`} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium text-foreground">{user.username}</td>
                  <td className="px-3 py-2 text-muted-foreground">{user.host ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATE_BADGE[user.state].tone}>
                      {STATE_BADGE[user.state].label}
                    </Badge>
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
        />
      )}
      <SnapshotModal serverId={serverId} database={snapshotDb} onClose={() => setSnapshotDb(null)} />
    </div>
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
