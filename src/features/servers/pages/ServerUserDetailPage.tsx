import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  AdoptionBadge,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  PageHeader,
  Spinner,
  TabButton,
} from '@/components/ui'
import type { EngineType, EngineUserIdentity, GroupedEngineUser } from '@/lib/contracts'
import { useServerUser } from '@/features/server-users/hooks/use-server-users'
import { EffectiveGrantsPanel } from '@/features/server-users/components/EffectiveGrantsPanel'
import { GrantPanel } from '@/features/server-users/components/GrantPanel'
import { OwnedDatabasesContent } from '@/features/server-users/components/OwnedDatabasesContent'
import { useServer } from '../hooks/use-servers'
import { useGroupedEngineUsers } from '../hooks/use-engine-users'
import {
  DESTRUCTIVE_IDENTITY_ACTIONS,
  identityActions,
  usernameActions,
} from '../components/engine-user-actions'
import { IdentityActionButtons, UsernameActionButtons } from '../components/EngineUserActionButtons'
import { useEngineUserDialogs } from '../components/use-engine-user-dialogs'

const TABS = ['identity', 'grants', 'manage', 'databases'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

/**
 * `?tab=profile` era la pestaña «Aplicar perfil», absorbida por «Otorgar / revocar» (v21): las
 * dos elegían un destino y aplicaban permisos, así que estar separadas obligaba a saber de
 * antemano cuál de las dos resolvía el caso. Los enlaces viejos siguen llegando a su sitio.
 */
function resolveTab(value: string | null): Tab {
  if (isTab(value)) return value
  if (value === 'profile') return 'manage'
  return 'identity'
}

const TAB_LABELS: Record<Tab, string> = {
  identity: 'Identidad',
  grants: 'Permisos efectivos',
  manage: 'Otorgar / revocar',
  databases: 'Bases de datos',
}

/**
 * Ficha física de una identidad de usuario del motor: `(server_id, username, host)` — host
 * ausente en PostgreSQL, que no tiene. Reemplaza el par «fila expandible de `EngineUsersPanel` +
 * página de permisos aparte (`/server-users/:id/grants`)» por una sola pantalla con pestañas,
 * mismo patrón que `ServerDatabaseDetailPage` (Fase 1).
 *
 * La identidad se resuelve desde `GET /{id}/users/grouped` (ya usado por `EngineUsersPanel`) en
 * vez de pedir un endpoint nuevo: cruza username+host contra la lista agrupada del servidor.
 *
 * **La ficha tiene TODAS las acciones de la identidad (R1)**, decididas por estado en
 * `engine-user-actions` —la misma fuente que usan las filas de `EngineUsersPanel`, que solo son
 * atajos— y ejecutadas por `useEngineUserDialogs`. Aquí no se decide qué botón aparece.
 */
export function ServerUserDetailPage() {
  const params = useParams()
  const serverId = Number(params.serverId)
  const username = params.username
  // Host ausente en la URL = identidad sin host (rol de PostgreSQL). React Router ya entrega el
  // segmento decodificado, igual criterio que `ServerDatabaseDetailPage`.
  const host = params.host

  const validParams = Number.isFinite(serverId) && username !== undefined
  const server = useServer(serverId)
  const grouped = useGroupedEngineUsers(serverId, validParams)

  const backTo = `/servers/${serverId}?tab=users`

  if (!validParams) {
    return <ErrorState error={new Error('Ruta de usuario del motor inválida.')} />
  }
  if (server.isLoading) return <FullPageSpinner label="Cargando servidor" />
  if (server.isError || !server.data) {
    return <ErrorState error={server.error} onRetry={() => void server.refetch()} />
  }
  if (grouped.isLoading) return <FullPageSpinner label="Cargando usuarios del motor" />
  if (grouped.isError || !grouped.data) {
    return <ErrorState error={grouped.error} onRetry={() => void grouped.refetch()} />
  }

  const groupedUser =
    grouped.data.users.find((candidate) => candidate.username === username) ?? null
  const identity =
    groupedUser?.identities.find((candidate) => (candidate.host ?? undefined) === host) ?? null

  // Caso real, no defensivo: pueden haberla eliminado desde otra pestaña o por fuera del
  // gateway (incluida esta misma ficha, tras «Eliminar del motor» o tras quitar del inventario
  // una huérfana: la invalidación de la query agrupada recalcula esto solo, sin navegar a mano).
  if (!groupedUser || !identity) {
    return (
      <div className="flex flex-col gap-6">
        <Link to={backTo} className="text-sm text-muted-foreground hover:text-foreground">
          ← Usuarios de {server.data.name}
        </Link>
        <EmptyState
          title="Esta identidad ya no existe en el servidor."
          description={`«${username}${host ? `@${host}` : ''}» no aparece en el listado del motor. Puede haberse eliminado desde otra pestaña o fuera del gateway.`}
          action={
            <Link to={backTo}>
              <Button variant="outline">Volver a usuarios del motor</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <ServerUserDetailContent
      serverId={serverId}
      serverName={server.data.name}
      engine={server.data.engine}
      supportsHosts={grouped.data.supports_hosts}
      groupedUser={groupedUser}
      identity={identity}
      backTo={backTo}
    />
  )
}

function ServerUserDetailContent({
  serverId,
  serverName,
  engine,
  supportsHosts,
  groupedUser,
  identity,
  backTo,
}: {
  serverId: number
  serverName: string
  engine: EngineType
  supportsHosts: boolean
  groupedUser: GroupedEngineUser
  identity: EngineUserIdentity
  backTo: string
}) {
  const username = groupedUser.username
  const host = identity.host ?? undefined

  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = resolveTab(tabParam)
  const setTab = (next: Tab) => {
    setSearchParams((previous) => {
      const updated = new URLSearchParams(previous)
      updated.set('tab', next)
      return updated
    })
  }

  const isAdopted = identity.status === 'adopted' && identity.server_user_id != null
  const serverUserId = identity.server_user_id ?? undefined
  // El registro del inventario (`ServerUserOut`) se pide siempre que haya fila —adoptada o
  // huérfana—: lo exigen «Editar» y «Quitar del inventario», que antes solo existían en el
  // listado `/server-users`. Otorgar y las BDs propias además exigen que esté ADOPTADA: todo el
  // otorgamiento cuelga del inventario (v21 §12). «Permisos efectivos» no, porque la CONSULTA
  // funciona por identidad (§1).
  const serverUser = useServerUser(serverUserId ?? 0, serverUserId != null)

  const actions = useEngineUserDialogs({
    serverId,
    serverName,
    supportsHosts,
    users: [groupedUser],
  })
  // «Permisos efectivos» es una pestaña de esta misma ficha, no un botón de la cabecera.
  const headerActions = identityActions(identity).filter((action) => action.id !== 'viewGrants')
  const editAction = headerActions.find((action) => action.id === 'edit')
  const runAction = (action: (typeof headerActions)[number]) =>
    actions.runIdentityAction(action, username, identity, serverUser.data)
  // La cabecera va en grupos: lo de esta identidad, lo de todos los hosts del username y, aparte,
  // lo que borra. En una sola tira, las destructivas quedaban en medio (antes de las acciones de
  // todos los hosts) y nada distinguía qué tocaba este host y qué todos.
  const identityGroup = headerActions.filter(
    (action) => !DESTRUCTIVE_IDENTITY_ACTIONS.has(action.id),
  )
  const destructiveGroup = headerActions.filter((action) =>
    DESTRUCTIVE_IDENTITY_ACTIONS.has(action.id),
  )
  const batchActions = usernameActions(groupedUser, supportsHosts)
  const subject = `${username}${host ? `@${host}` : ''}`

  const requiresAdoption = tab === 'manage' || tab === 'databases'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to={backTo} className="text-sm text-muted-foreground hover:text-foreground">
          ← Usuarios de {serverName}
        </Link>
        <PageHeader
          title={`${username}${host ? `@${host}` : ''}`}
          description={`Identidad física en «${serverName}» (${engine}): estado frente al inventario y, si está adoptada, sus permisos. Las acciones que tocan el motor real van marcadas con 🔌.`}
          actions={
            <>
              {/* Acciones de esta identidad puntual (server_id, username, host): mismo patrón que
                  `ServerDatabaseDetailPage`, siempre visibles en la cabecera sin depender de qué
                  pestaña esté activa. */}
              {identityGroup.length > 0 && (
                <div role="group" aria-label="Esta identidad" className="flex flex-wrap gap-2">
                  <IdentityActionButtons
                    actions={identityGroup}
                    layout="header"
                    subject={subject}
                    recordReady={serverUser.data != null}
                    recordLoading={serverUser.isLoading}
                    onRun={runAction}
                  />
                </div>
              )}
              {/* Acciones batch (§7.4) a nivel de USERNAME, no de esta identidad puntual: operan
                  sobre todas las identidades/hosts en vivo de «{username}». */}
              {batchActions.length > 0 && (
                <div
                  role="group"
                  aria-label={`Todos los hosts de «${username}»`}
                  className="flex flex-wrap gap-2"
                >
                  <UsernameActionButtons
                    actions={batchActions}
                    onRun={(action) => actions.runUsernameAction(action.id, username, host)}
                  />
                </div>
              )}
              {destructiveGroup.length > 0 && (
                <div
                  role="group"
                  aria-label="Destructivas"
                  className="flex flex-wrap gap-2 sm:border-l sm:border-border sm:pl-3"
                >
                  <IdentityActionButtons
                    actions={destructiveGroup}
                    layout="header"
                    subject={subject}
                    recordReady={serverUser.data != null}
                    recordLoading={serverUser.isLoading}
                    isRemoving={actions.isRemovingOrphan(identity)}
                    onRun={runAction}
                  />
                </div>
              )}
            </>
          }
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <AdoptionBadge status={identity.status} />
          <Badge tone={identity.has_password ? 'success' : 'neutral'}>
            {identity.has_password ? 'Contraseña conocida' : 'Contraseña no conocida'}
          </Badge>
          {identity.is_active != null && (
            <Badge tone={identity.is_active ? 'success' : 'neutral'}>
              {identity.is_active ? 'Activo' : 'Inactivo'}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-border" role="tablist">
        {TABS.map((item) => (
          <TabButton key={item} active={tab === item} onClick={() => setTab(item)}>
            {TAB_LABELS[item]}
          </TabButton>
        ))}
      </div>

      {/* Con las acciones ya en la cabecera, esta pestaña queda como resumen de solo lectura:
          todos los hosts conocidos de «{username}» (o la nota de que este motor no usa hosts). */}
      {tab === 'identity' && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">Hosts de «{username}»</h2>
            {supportsHosts ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-3 py-1.5 font-semibold">Host</th>
                      <th className="px-3 py-1.5 font-semibold">Estado</th>
                      <th className="px-3 py-1.5 font-semibold">Contraseña</th>
                      <th className="px-3 py-1.5 font-semibold">Activo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedUser.identities.map((candidate) => (
                      <tr
                        key={candidate.host ?? '(sin host)'}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-3 py-1.5 font-mono text-xs text-foreground">
                          {candidate.host ?? '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          <AdoptionBadge status={candidate.status} />
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge tone={candidate.has_password ? 'success' : 'neutral'}>
                            {candidate.has_password ? 'Conocida' : 'No conocida'}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {candidate.is_active == null ? '—' : candidate.is_active ? 'Sí' : 'No'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Este motor no usa hosts: la identidad es única por usuario.
              </p>
            )}
            {/* Notas y «activo» son datos del inventario: se editan con la misma acción «Editar»
                de la cabecera, que solo existe cuando hay registro. */}
            {(identity.notes || editAction) && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  Notas: {identity.notes || 'sin notas.'}
                </p>
                {editAction && (
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={serverUser.isLoading}
                    disabled={serverUser.data == null}
                    onClick={() => runAction(editAction)}
                  >
                    Editar
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Consultar no exige adopción (v21 §1), otorgar sí (§12). Esa asimetría es el límite
          actual del módulo y acá se traduce en qué pestañas piden fila de inventario. */}
      {tab === 'grants' && (
        <EffectiveGrantsPanel
          serverId={serverId}
          username={username}
          host={host}
          engine={engine}
          serverUserId={isAdopted ? serverUserId : undefined}
        />
      )}

      {requiresAdoption &&
        (!isAdopted || serverUserId == null ? (
          identity.status === 'orphan' ? (
            // Huérfana: está en el inventario pero no en el motor. No hay nada que adoptar —
            // `adopt` busca la identidad en el motor—; la salida es recrearla, desde la cabecera.
            <EmptyState
              title="Esta identidad ya no existe en el motor"
              description="Otorgar permisos y listar las bases propias necesitan que la identidad exista en el motor. Recréala desde la cabecera o quítala del inventario."
            />
          ) : (
            <EmptyState
              title="Esta identidad no está adoptada"
              description="Otorgar permisos y listar las bases propias son operaciones de inventario: adoptá primero esta identidad. Consultar sus permisos efectivos sí funciona sin adoptarla."
              action={
                identity.status === 'unmanaged' ? (
                  <Button
                    onClick={() =>
                      actions.runIdentityAction(
                        { id: 'adopt', needsRecord: false },
                        username,
                        identity,
                      )
                    }
                  >
                    Adoptar esta identidad para gestionar sus permisos
                  </Button>
                ) : undefined
              }
            />
          )
        ) : serverUser.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando usuario…
          </div>
        ) : serverUser.isError || !serverUser.data ? (
          <ErrorState error={serverUser.error} onRetry={() => void serverUser.refetch()} />
        ) : (
          <>
            {tab === 'manage' && <GrantPanel user={serverUser.data} engine={engine} />}
            {tab === 'databases' && <OwnedDatabasesContent userId={serverUser.data.id} />}
          </>
        ))}

      {actions.dialogs}
    </div>
  )
}
