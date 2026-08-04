import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  RefreshIcon,
  Spinner,
  TrashIcon,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { queryKeys } from '@/lib/api/query-keys'
import type {
  EngineType,
  EngineUserIdentity,
  EngineUserIdentityStatus,
  GroupedEngineUser,
} from '@/lib/contracts'
import { AdoptUserModal } from '@/features/server-users/components/AdoptUserModal'
import { useDeleteServerUser } from '@/features/server-users/hooks/use-server-user-mutations'
import { useGroupedEngineUsers } from '../hooks/use-engine-users'
import { CreateEngineUserModal } from './CreateEngineUserModal'
import { ChangeEngineUserPasswordModal } from './ChangeEngineUserPasswordModal'
import { DeleteEngineUserDialog } from './DeleteEngineUserDialog'
import { AddEngineUserHostModal } from './AddEngineUserHostModal'
import { RevealEngineUserPasswordModal } from './RevealEngineUserPasswordModal'
import { AdoptAllHostsModal } from './AdoptAllHostsModal'
import { DefineKnownPasswordModal } from './DefineKnownPasswordModal'
import { RotatePasswordAllHostsModal } from './RotatePasswordAllHostsModal'

const STATUS_BADGE: Record<
  EngineUserIdentityStatus,
  { tone: 'success' | 'warning' | 'error'; label: string }
> = {
  adopted: { tone: 'success', label: '🟢 Adoptado' },
  unmanaged: { tone: 'warning', label: '🟡 Sin adoptar' },
  orphan: { tone: 'error', label: '🔴 Huérfano' },
}

interface IdentityTarget {
  username: string
  host?: string | null
}

/**
 * Usuarios del motor agrupados por identidad física (docs/features/engine-users-management.md).
 * Reemplaza el listado plano de introspección: una fila por username, expandible a sus
 * identidades (hosts en MySQL/MariaDB; una sola en PostgreSQL, que no tiene host).
 *
 * `engine` ya no se consume aquí —la página de permisos resuelve el motor por su cuenta desde el
 * usuario—, pero sigue en las props porque el detalle de servidor lo pasa.
 */
export function EngineUsersPanel({ serverId }: { serverId: number; engine: EngineType }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error, refetch, isFetching } = useGroupedEngineUsers(serverId)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [createTarget, setCreateTarget] = useState<IdentityTarget | 'new' | null>(null)
  const [passwordTarget, setPasswordTarget] = useState<
    (IdentityTarget & { alreadyAdopted: boolean }) | null
  >(null)
  const [deleteTarget, setDeleteTarget] = useState<IdentityTarget | null>(null)
  const [addHostTarget, setAddHostTarget] = useState<{
    username: string
    sourceHostOptions: string[]
    defaultSourceHost?: string
  } | null>(null)
  const [revealTarget, setRevealTarget] = useState<IdentityTarget | null>(null)
  const [adoptTarget, setAdoptTarget] = useState<IdentityTarget | null>(null)
  // Acciones batch (§7.4) a nivel de username, no de identidad.
  const [adoptAllTarget, setAdoptAllTarget] = useState<string | null>(null)
  const [defineTarget, setDefineTarget] = useState<{
    username: string
    defaultHost?: string | null
  } | null>(null)
  const [rotateAllTarget, setRotateAllTarget] = useState<string | null>(null)
  const [cleanupId, setCleanupId] = useState<number | null>(null)

  const deleteServerUser = useDeleteServerUser()

  // Los permisos son una página propia: se navega con `from` para que su enlace «volver» regrese
  // a ESTA pestaña del detalle de servidor y no a la lista general de usuarios.
  const goToGrants = (serverUserId: number) => {
    void navigate(
      `/server-users/${serverUserId}/grants?from=${encodeURIComponent(`/servers/${serverId}?tab=users`)}`,
    )
  }

  const counts = useMemo(() => {
    const acc = { adopted: 0, unmanaged: 0, orphan: 0 }
    for (const user of data?.users ?? []) {
      for (const identity of user.identities) acc[identity.status] += 1
    }
    return acc
  }, [data])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando usuarios del motor…
      </div>
    )
  }
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null

  const supportsHosts = data.supports_hosts

  const toggleExpand = (username: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(username)) next.delete(username)
      else next.add(username)
      return next
    })
  }

  const cleanupOrphan = (serverUserId: number) => {
    setCleanupId(serverUserId)
    deleteServerUser.mutate(
      { id: serverUserId, dropRemote: false },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.servers.groupedUsers(serverId) })
          setCleanupId(null)
        },
        onError: () => setCleanupId(null),
      },
    )
  }

  const identityActions = (username: string, identity: EngineUserIdentity) => {
    const host = identity.host ?? undefined
    switch (identity.status) {
      case 'adopted':
        return (
          <div className="flex flex-wrap justify-end gap-1.5">
            {identity.has_password ? (
              <Button variant="ghost" size="sm" onClick={() => setRevealTarget({ username, host })}>
                Revelar
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPasswordTarget({ username, host, alreadyAdopted: true })}
            >
              Rotar contraseña
            </Button>
            <Button
              variant="ghost"
              size="sm"
              // Una identidad adoptada siempre tiene registro en el inventario; si por lo que
              // fuera faltara, no hay página a la que ir.
              disabled={identity.server_user_id == null}
              onClick={() => {
                if (identity.server_user_id != null) goToGrants(identity.server_user_id)
              }}
            >
              Ver grants
            </Button>
            <IconButton
              label="Eliminar"
              icon={<TrashIcon />}
              variant="danger-soft"
              size="icon-sm"
              onClick={() => setDeleteTarget({ username, host })}
            />
          </div>
        )
      case 'unmanaged':
        return (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setAdoptTarget({ username, host })}>
              Adoptar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPasswordTarget({ username, host, alreadyAdopted: false })}
            >
              Rotar contraseña
            </Button>
            <IconButton
              label="Eliminar"
              icon={<TrashIcon />}
              variant="danger-soft"
              size="icon-sm"
              onClick={() => setDeleteTarget({ username, host })}
            />
          </div>
        )
      case 'orphan':
        return (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setCreateTarget({ username, host })}>
              Recrear en el motor
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isLoading={cleanupId === identity.server_user_id}
              onClick={() => identity.server_user_id && cleanupOrphan(identity.server_user_id)}
            >
              Limpiar registro
            </Button>
          </div>
        )
    }
  }

  /**
   * Acciones batch (§7.4) a nivel de FILA DE USERNAME (operan sobre todas sus identidades):
   * - Adoptar todos los hosts: solo con hosts (en PostgreSQL la única identidad ya tiene su
   *   "Adoptar" por identidad en esta misma fila) y con ≥1 identidad `unmanaged`.
   * - Definir contraseña conocida: SIEMPRE disponible (flujo DEFINIR, distinto de ROTAR).
   * - Rotar en todos los hosts: solo con hosts y >1 identidad (con una sola ya existe la
   *   rotación individual).
   */
  const batchActions = (user: GroupedEngineUser) => {
    const hasUnmanaged = user.identities.some((identity) => identity.status === 'unmanaged')
    return (
      <div className="flex flex-wrap justify-end gap-1.5">
        {supportsHosts && hasUnmanaged && (
          <Button variant="outline" size="sm" onClick={() => setAdoptAllTarget(user.username)}>
            Adoptar todos los hosts
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDefineTarget({ username: user.username })}
        >
          Definir contraseña
        </Button>
        {supportsHosts && user.identity_count > 1 && (
          <Button variant="ghost" size="sm" onClick={() => setRotateAllTarget(user.username)}>
            Rotar en todos los hosts
          </Button>
        )}
      </div>
    )
  }

  /** Hosts en vivo (no `orphan`) de un username — opciones del alcance «una identidad». */
  const liveHostsOf = (username: string): string[] =>
    (data.users.find((user) => user.username === username)?.identities ?? [])
      .filter((identity) => identity.status !== 'orphan')
      .map((identity) => identity.host)
      .filter((host): host is string => Boolean(host))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {counts.adopted} adoptado(s) · {counts.unmanaged} sin adoptar · {counts.orphan}{' '}
          huérfano(s)
        </p>
        <div className="flex gap-2">
          <IconButton
            label="Actualizar"
            icon={<RefreshIcon />}
            variant="ghost"
            size="icon-sm"
            onClick={() => void refetch()}
            isLoading={isFetching}
          />
          <Button size="sm" onClick={() => setCreateTarget('new')}>
            Crear usuario
          </Button>
        </div>
      </div>

      {data.users.length === 0 ? (
        <EmptyState
          title="No hay usuarios"
          description="Crea un usuario del motor para empezar a gestionarlo."
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Usuario</th>
                {supportsHosts && <th className="px-3 py-2 font-semibold">Hosts</th>}
                {!supportsHosts && <th className="px-3 py-2 font-semibold">Estado</th>}
                {!supportsHosts && <th className="px-3 py-2 font-semibold">Contraseña</th>}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => {
                const singleIdentity = !supportsHosts ? user.identities[0] : undefined
                const isExpanded = expanded.has(user.username)
                return (
                  <Fragment key={user.username}>
                    <tr className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium text-foreground">
                        {supportsHosts ? (
                          <button
                            type="button"
                            onClick={() => toggleExpand(user.username)}
                            aria-expanded={isExpanded}
                            className="flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              className={cn(
                                'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                                isExpanded && 'rotate-90',
                              )}
                              fill="none"
                              stroke="currentColor"
                              aria-hidden
                            >
                              <path
                                d="M7 4l6 6-6 6"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            {user.username}
                          </button>
                        ) : (
                          user.username
                        )}
                      </td>
                      {supportsHosts && (
                        <td className="px-3 py-2">
                          <Badge tone="neutral">
                            {user.identity_count} host{user.identity_count === 1 ? '' : 's'}
                          </Badge>
                        </td>
                      )}
                      {!supportsHosts && singleIdentity && (
                        <td className="px-3 py-2">
                          <Badge tone={STATUS_BADGE[singleIdentity.status].tone}>
                            {STATUS_BADGE[singleIdentity.status].label}
                          </Badge>
                        </td>
                      )}
                      {!supportsHosts && singleIdentity && (
                        <td className="px-3 py-2">
                          <Badge tone={singleIdentity.has_password ? 'success' : 'neutral'}>
                            {singleIdentity.has_password ? 'Conocida' : 'No conocida'}
                          </Badge>
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <div className="flex flex-col items-end gap-1.5">
                          {!supportsHosts && singleIdentity
                            ? identityActions(user.username, singleIdentity)
                            : null}
                          {batchActions(user)}
                        </div>
                      </td>
                    </tr>

                    {supportsHosts && isExpanded && (
                      <tr className="border-b border-border bg-surface-muted/40 last:border-0">
                        <td colSpan={3} className="px-3 py-3">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Identidades de «{user.username}»
                              </p>
                              {(() => {
                                // Solo identidades que realmente existen en el motor (no `orphan`)
                                // sirven de origen para clonar — `SHOW CREATE USER` fallaría si no.
                                const liveHosts = user.identities
                                  .filter((identity) => identity.status !== 'orphan')
                                  .map((identity) => identity.host)
                                  .filter((host): host is string => Boolean(host))
                                return (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={liveHosts.length === 0}
                                    title={
                                      liveHosts.length === 0
                                        ? 'Ningún host de este usuario existe hoy en el motor (todos huérfanos)'
                                        : undefined
                                    }
                                    onClick={() =>
                                      setAddHostTarget({
                                        username: user.username,
                                        sourceHostOptions: liveHosts,
                                        defaultSourceHost: liveHosts[0],
                                      })
                                    }
                                  >
                                    Agregar host
                                  </Button>
                                )
                              })()}
                            </div>
                            <div className="overflow-x-auto rounded-lg border border-border">
                              <table className="w-full border-collapse text-sm">
                                <thead>
                                  <tr className="border-b border-border text-left text-muted-foreground">
                                    <th className="px-3 py-1.5 font-semibold">Host</th>
                                    <th className="px-3 py-1.5 font-semibold">Estado</th>
                                    <th className="px-3 py-1.5 font-semibold">Contraseña</th>
                                    <th className="px-3 py-1.5 font-semibold">Activo</th>
                                    <th className="px-3 py-1.5" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {user.identities.map((identity) => (
                                    <tr
                                      key={identity.host ?? '(sin host)'}
                                      className="border-b border-border bg-surface last:border-0"
                                    >
                                      <td className="px-3 py-1.5 font-mono text-xs text-foreground">
                                        {identity.host ?? '—'}
                                      </td>
                                      <td className="px-3 py-1.5">
                                        <Badge tone={STATUS_BADGE[identity.status].tone}>
                                          {STATUS_BADGE[identity.status].label}
                                        </Badge>
                                      </td>
                                      <td className="px-3 py-1.5">
                                        <Badge tone={identity.has_password ? 'success' : 'neutral'}>
                                          {identity.has_password ? 'Conocida' : 'No conocida'}
                                        </Badge>
                                      </td>
                                      <td className="px-3 py-1.5 text-muted-foreground">
                                        {identity.is_active == null
                                          ? '—'
                                          : identity.is_active
                                            ? 'Sí'
                                            : 'No'}
                                      </td>
                                      <td className="px-3 py-1.5">
                                        {identityActions(user.username, identity)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {createTarget && (
        <CreateEngineUserModal
          onClose={() => setCreateTarget(null)}
          serverId={serverId}
          supportsHosts={supportsHosts}
          prefill={createTarget === 'new' ? undefined : createTarget}
        />
      )}
      {passwordTarget && (
        <ChangeEngineUserPasswordModal
          onClose={() => setPasswordTarget(null)}
          serverId={serverId}
          username={passwordTarget.username}
          host={passwordTarget.host}
          alreadyAdopted={passwordTarget.alreadyAdopted}
        />
      )}
      {deleteTarget && (
        <DeleteEngineUserDialog
          onClose={() => setDeleteTarget(null)}
          serverId={serverId}
          username={deleteTarget.username}
          host={deleteTarget.host}
        />
      )}
      {addHostTarget && (
        <AddEngineUserHostModal
          onClose={() => setAddHostTarget(null)}
          serverId={serverId}
          username={addHostTarget.username}
          sourceHostOptions={addHostTarget.sourceHostOptions}
          defaultSourceHost={addHostTarget.defaultSourceHost}
        />
      )}
      {revealTarget && (
        <RevealEngineUserPasswordModal
          onClose={() => setRevealTarget(null)}
          serverId={serverId}
          username={revealTarget.username}
          host={revealTarget.host}
        />
      )}
      {adoptTarget && (
        <AdoptUserModal
          open
          onClose={() => setAdoptTarget(null)}
          serverId={serverId}
          username={adoptTarget.username}
          host={adoptTarget.host}
          onDefinePassword={() => {
            // La identidad nace sin contraseña: encadena con «Definir contraseña conocida».
            setDefineTarget({ username: adoptTarget.username, defaultHost: adoptTarget.host })
            setAdoptTarget(null)
          }}
        />
      )}
      {adoptAllTarget && (
        <AdoptAllHostsModal
          onClose={() => setAdoptAllTarget(null)}
          serverId={serverId}
          username={adoptAllTarget}
          supportsHosts={supportsHosts}
        />
      )}
      {defineTarget && (
        <DefineKnownPasswordModal
          onClose={() => setDefineTarget(null)}
          serverId={serverId}
          username={defineTarget.username}
          supportsHosts={supportsHosts}
          hostOptions={liveHostsOf(defineTarget.username)}
          defaultHost={defineTarget.defaultHost}
        />
      )}
      {rotateAllTarget && (
        <RotatePasswordAllHostsModal
          onClose={() => setRotateAllTarget(null)}
          serverId={serverId}
          username={rotateAllTarget}
        />
      )}
    </div>
  )
}
