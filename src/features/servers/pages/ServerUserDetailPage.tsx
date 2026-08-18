import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  AdoptionBadge,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  IconButton,
  PageHeader,
  Spinner,
  TabButton,
  TrashIcon,
} from '@/components/ui'
import { queryKeys } from '@/lib/api/query-keys'
import type { EngineType, EngineUserIdentity, GroupedEngineUser } from '@/lib/contracts'
import { AdoptUserModal } from '@/features/server-users/components/AdoptUserModal'
import { useDeleteServerUser } from '@/features/server-users/hooks/use-server-user-mutations'
import { useServerUser } from '@/features/server-users/hooks/use-server-users'
import { EffectiveGrantsPanel } from '@/features/server-users/components/EffectiveGrantsPanel'
import { GrantManager } from '@/features/server-users/components/GrantManager'
import { ApplyProfilePanel } from '@/features/server-users/components/ApplyProfilePanel'
import { OwnedDatabasesContent } from '@/features/server-users/components/OwnedDatabasesContent'
import { useServer } from '../hooks/use-servers'
import { useGroupedEngineUsers } from '../hooks/use-engine-users'
import { CreateEngineUserModal } from '../components/CreateEngineUserModal'
import { ChangeEngineUserPasswordModal } from '../components/ChangeEngineUserPasswordModal'
import { DeleteEngineUserDialog } from '../components/DeleteEngineUserDialog'
import { AddEngineUserHostModal } from '../components/AddEngineUserHostModal'
import { RevealEngineUserPasswordModal } from '../components/RevealEngineUserPasswordModal'
import { AdoptAllHostsModal } from '../components/AdoptAllHostsModal'
import { DefineKnownPasswordModal } from '../components/DefineKnownPasswordModal'
import { RotatePasswordAllHostsModal } from '../components/RotatePasswordAllHostsModal'

const TABS = ['identity', 'grants', 'manage', 'profile', 'databases'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

const TAB_LABELS: Record<Tab, string> = {
  identity: 'Identidad',
  grants: 'Permisos efectivos',
  manage: 'Otorgar / revocar',
  profile: 'Aplicar perfil',
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
  // gateway (incluida esta misma ficha, tras un "Eliminar"/"Limpiar registro" exitoso: la
  // invalidación de la query agrupada recalcula esto solo, sin necesidad de navegar a mano).
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

  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = isTab(tabParam) ? tabParam : 'identity'
  const setTab = (next: Tab) => {
    setSearchParams((previous) => {
      const updated = new URLSearchParams(previous)
      updated.set('tab', next)
      return updated
    })
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [revealOpen, setRevealOpen] = useState(false)
  const [adoptOpen, setAdoptOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [addHostOpen, setAddHostOpen] = useState(false)
  const [adoptAllOpen, setAdoptAllOpen] = useState(false)
  const [defineOpen, setDefineOpen] = useState(false)
  const [rotateAllOpen, setRotateAllOpen] = useState(false)
  const [cleanupPending, setCleanupPending] = useState(false)

  const deleteServerUser = useDeleteServerUser()

  // Hosts EN VIVO (no `orphan`) de este username — opciones de "Agregar host"/"Definir
  // contraseña" y condición de "Adoptar todos los hosts", igual criterio que `EngineUsersPanel`.
  const liveHosts = groupedUser.identities
    .filter((candidate) => candidate.status !== 'orphan')
    .map((candidate) => candidate.host)
    .filter((candidateHost): candidateHost is string => Boolean(candidateHost))

  const isAdopted = identity.status === 'adopted' && identity.server_user_id != null
  const serverUserId = identity.server_user_id ?? undefined
  // Las 4 pestañas de permisos exigen `server_user_id` numérico: sus hooks no aceptan
  // username/host. La query solo se dispara si de verdad hay a quién pedirle el registro.
  const serverUser = useServerUser(serverUserId ?? 0, isAdopted && serverUserId != null)

  const cleanupOrphan = () => {
    if (identity.server_user_id == null) return
    setCleanupPending(true)
    deleteServerUser.mutate(
      { id: identity.server_user_id, dropRemote: false },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.servers.groupedUsers(serverId) })
          setCleanupPending(false)
        },
        onError: () => setCleanupPending(false),
      },
    )
  }

  const showPermissionsTabs = tab !== 'identity'

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
              {identity.status === 'adopted' && (
                <>
                  {identity.has_password && (
                    <Button variant="ghost" size="sm" onClick={() => setRevealOpen(true)}>
                      Revelar
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setPasswordOpen(true)}>
                    Rotar contraseña
                  </Button>
                  <IconButton
                    label="Eliminar"
                    icon={<TrashIcon />}
                    variant="danger-soft"
                    size="icon-sm"
                    onClick={() => setDeleteOpen(true)}
                  />
                </>
              )}
              {identity.status === 'unmanaged' && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setAdoptOpen(true)}>
                    Adoptar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPasswordOpen(true)}>
                    Rotar contraseña
                  </Button>
                  <IconButton
                    label="Eliminar"
                    icon={<TrashIcon />}
                    variant="danger-soft"
                    size="icon-sm"
                    onClick={() => setDeleteOpen(true)}
                  />
                </>
              )}
              {identity.status === 'orphan' && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                    Recrear en el motor
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={cleanupPending}
                    onClick={cleanupOrphan}
                  >
                    Limpiar registro
                  </Button>
                </>
              )}

              {/* Acciones batch (§7.4) a nivel de USERNAME, no de esta identidad puntual: operan
                  sobre todas las identidades/hosts en vivo de «{username}». */}
              {supportsHosts && identity.status !== 'orphan' && (
                <span
                  title={
                    liveHosts.length === 0
                      ? 'Ningún host de este usuario existe hoy en el motor (todos huérfanos)'
                      : undefined
                  }
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={liveHosts.length === 0}
                    onClick={() => setAddHostOpen(true)}
                  >
                    Agregar host
                  </Button>
                </span>
              )}
              {supportsHosts &&
                groupedUser.identities.some((candidate) => candidate.status === 'unmanaged') && (
                  <Button variant="outline" size="sm" onClick={() => setAdoptAllOpen(true)}>
                    Adoptar todos los hosts
                  </Button>
                )}
              <Button variant="ghost" size="sm" onClick={() => setDefineOpen(true)}>
                Definir contraseña
              </Button>
              {supportsHosts && groupedUser.identity_count > 1 && (
                <Button variant="ghost" size="sm" onClick={() => setRotateAllOpen(true)}>
                  Rotar en todos los hosts
                </Button>
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
            {identity.notes && (
              <p className="text-sm text-muted-foreground">Notas: {identity.notes}</p>
            )}
          </CardContent>
        </Card>
      )}

      {showPermissionsTabs &&
        (!isAdopted || serverUserId == null ? (
          <EmptyState
            title="Esta identidad no está adoptada"
            description="Los permisos y las bases de datos propias son operaciones de inventario: adopta primero esta identidad para gestionarlos."
            action={
              <Button onClick={() => setAdoptOpen(true)}>
                Adoptar esta identidad para gestionar sus permisos
              </Button>
            }
          />
        ) : serverUser.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando usuario…
          </div>
        ) : serverUser.isError || !serverUser.data ? (
          <ErrorState error={serverUser.error} onRetry={() => void serverUser.refetch()} />
        ) : (
          <>
            {tab === 'grants' && <EffectiveGrantsPanel user={serverUser.data} engine={engine} />}
            {tab === 'manage' && <GrantManager user={serverUser.data} engine={engine} />}
            {tab === 'profile' && <ApplyProfilePanel user={serverUser.data} engine={engine} />}
            {tab === 'databases' && <OwnedDatabasesContent userId={serverUser.data.id} />}
          </>
        ))}

      {createOpen && (
        <CreateEngineUserModal
          onClose={() => setCreateOpen(false)}
          serverId={serverId}
          supportsHosts={supportsHosts}
          prefill={{ username, host }}
        />
      )}
      {passwordOpen && (
        <ChangeEngineUserPasswordModal
          onClose={() => setPasswordOpen(false)}
          serverId={serverId}
          username={username}
          host={host}
          alreadyAdopted={identity.status === 'adopted'}
        />
      )}
      {deleteOpen && (
        <DeleteEngineUserDialog
          onClose={() => setDeleteOpen(false)}
          serverId={serverId}
          username={username}
          host={host}
        />
      )}
      {addHostOpen && (
        <AddEngineUserHostModal
          onClose={() => setAddHostOpen(false)}
          serverId={serverId}
          username={username}
          sourceHostOptions={liveHosts}
          defaultSourceHost={liveHosts[0]}
        />
      )}
      {revealOpen && (
        <RevealEngineUserPasswordModal
          onClose={() => setRevealOpen(false)}
          serverId={serverId}
          username={username}
          host={host}
        />
      )}
      {adoptOpen && (
        <AdoptUserModal
          open
          onClose={() => setAdoptOpen(false)}
          serverId={serverId}
          username={username}
          host={host}
          onDefinePassword={() => {
            // La identidad nace sin contraseña: encadena con «Definir contraseña conocida».
            setDefineOpen(true)
            setAdoptOpen(false)
          }}
        />
      )}
      {adoptAllOpen && (
        <AdoptAllHostsModal
          onClose={() => setAdoptAllOpen(false)}
          serverId={serverId}
          username={username}
          supportsHosts={supportsHosts}
        />
      )}
      {defineOpen && (
        <DefineKnownPasswordModal
          onClose={() => setDefineOpen(false)}
          serverId={serverId}
          username={username}
          supportsHosts={supportsHosts}
          hostOptions={liveHosts}
          defaultHost={host}
        />
      )}
      {rotateAllOpen && (
        <RotatePasswordAllHostsModal
          onClose={() => setRotateAllOpen(false)}
          serverId={serverId}
          username={username}
        />
      )}
    </div>
  )
}
