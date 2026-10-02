import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AdoptionBadge,
  Badge,
  Button,
  Callout,
  EmptyState,
  ErrorState,
  IconButton,
  RefreshIcon,
  Spinner,
} from '@/components/ui'
import { CapabilityHint, useCapabilities, useCapabilityGuard } from '@/features/auth'
import { cn } from '@/lib/utils'
import { serverUserPath } from '@/lib/routes'
import {
  CAPABILITIES,
  type EngineType,
  type EngineUserIdentity,
  type GroupedEngineUser,
} from '@/lib/contracts'
import { useGroupedEngineUsers } from '../hooks/use-engine-users'
import { engineUserAccessNote, rowIdentityActions, usernameActions } from './engine-user-actions'
import { IdentityActionButtons, UsernameActionButtons } from './EngineUserActionButtons'
import { useEngineUserDialogs } from './use-engine-user-dialogs'

/**
 * Usuarios del motor agrupados por identidad física (docs/features/engine-users-management.md).
 * Reemplaza el listado plano de introspección: una fila por username, expandible a sus
 * identidades (hosts en MySQL/MariaDB; una sola en PostgreSQL, que no tiene host).
 *
 * Las acciones de cada fila son un ATAJO a las de la ficha (`ServerUserDetailPage`): no se
 * deciden aquí sino en `engine-user-actions`, que la ficha comparte, y los diálogos los aloja
 * `useEngineUserDialogs`. La fila solo resta lo que no sabe ejecutar sin el registro del
 * inventario (editar, quitar una adoptada); todo lo que ofrece está también en la ficha (R1).
 *
 * `engine` ya no se consume aquí —la página de permisos resuelve el motor por su cuenta desde el
 * usuario—, pero sigue en las props porque el detalle de servidor lo pasa.
 */
export function EngineUsersPanel({ serverId }: { serverId: number; engine: EngineType }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useGroupedEngineUsers(serverId)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { can } = useCapabilities()
  // «Crear usuario» acá es `CREATE USER` con contraseña (`POST /servers/{id}/users`): pide
  // `engine_users.credentials` EN este servidor, no `write`. El alta de inventario sin contraseña
  // vive en «Usuarios y permisos».
  const createGuard = useCapabilityGuard(
    CAPABILITIES.engineUsersCredentials,
    'crear usuarios en el motor',
    { scope: { serverId, environmentId: null } },
  )
  const accessNote = engineUserAccessNote(can)
  const actions = useEngineUserDialogs({
    serverId,
    supportsHosts: data?.supports_hosts ?? false,
    users: data?.users ?? [],
  })

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

  const identityActions = (username: string, identity: EngineUserIdentity) => (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <IdentityActionButtons
        actions={rowIdentityActions(identity, can)}
        layout="row"
        subject={identity.host ? `${username}@${identity.host}` : username}
        isRemoving={actions.isRemovingOrphan(identity)}
        onRun={(action) => actions.runIdentityAction(action, username, identity)}
      />
    </div>
  )

  /**
   * Acciones batch (§7.4) a nivel de FILA DE USERNAME (operan sobre todas sus identidades).
   * «Agregar host» sale de la misma lista pero se pinta en la cabecera de las identidades
   * desplegadas, junto a los hosts que clona.
   */
  const batchActions = (user: GroupedEngineUser) => (
    <div className="flex flex-wrap justify-end gap-1.5">
      <UsernameActionButtons
        actions={usernameActions(user, supportsHosts, can).filter(
          (action) => action.id !== 'addHost',
        )}
        onRun={(action) => actions.runUsernameAction(action.id, user.username)}
      />
    </div>
  )

  const addHostAction = (user: GroupedEngineUser) => (
    <div className="flex flex-wrap justify-end gap-1.5">
      <UsernameActionButtons
        actions={usernameActions(user, supportsHosts, can).filter(
          (action) => action.id === 'addHost',
        )}
        onRun={(action) => actions.runUsernameAction(action.id, user.username)}
      />
    </div>
  )

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
          <Button
            size="sm"
            onClick={actions.openCreate}
            disabled={!createGuard.allowed}
            aria-describedby={createGuard.describedBy}
          >
            Crear usuario
          </Button>
        </div>
        <CapabilityHint guard={createGuard} className="basis-full text-right" />
      </div>

      {accessNote && (
        <Callout tone="info" title="Algunas acciones no están disponibles con tu acceso">
          <p>{accessNote}</p>
        </Callout>
      )}

      {data.users.length === 0 ? (
        <EmptyState
          title="No hay usuarios"
          description="Creá un usuario del motor para empezar a gestionarlo."
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
                          // Único host (o ninguno, en PostgreSQL): la fila YA es una identidad
                          // concreta, así que el username enlaza directo a su ficha.
                          <Link
                            to={serverUserPath(serverId, user.username, singleIdentity?.host)}
                            className="hover:text-primary hover:underline"
                          >
                            {user.username}
                          </Link>
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
                          <AdoptionBadge status={singleIdentity.status} />
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
                              {addHostAction(user)}
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
                                        {identity.host ? (
                                          <Link
                                            to={serverUserPath(
                                              serverId,
                                              user.username,
                                              identity.host,
                                            )}
                                            className="hover:text-primary hover:underline"
                                          >
                                            {identity.host}
                                          </Link>
                                        ) : (
                                          '—'
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5">
                                        <AdoptionBadge status={identity.status} />
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

      {actions.dialogs}
    </div>
  )
}
