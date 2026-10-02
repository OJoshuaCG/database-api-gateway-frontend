import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  Callout,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  Modal,
  OneTimeSecretPanel,
  PageHeader,
  Pagination,
  PencilIcon,
  StatusLegend,
  TabButton,
  buttonClassName,
} from '@/components/ui'
import { ForbiddenState, isAccessForbidden, useCapabilities, useSession } from '@/features/auth'
import {
  CAPABILITIES,
  PAGINATION,
  isSyntheticGatewayEmail,
  type GatewayUserOut,
} from '@/lib/contracts'
import { gatewayUserAccessPath } from '@/lib/routes'
import { formatDateTime } from '@/lib/utils'
import { PendingCapabilityGrantsCard } from '../components/PendingCapabilityGrantsCard'
import { GatewayUserFormModal } from '../components/GatewayUserFormModal'
import { RolesCapabilitiesPanel } from '../components/RolesCapabilitiesPanel'
import { usePendingCapabilityGrants } from '../hooks/use-capability-grants'
import { useGatewayUsers, useReissueGatewayUserInvite } from '../hooks/use-gateway-users'
import { buildInviteLink } from '../invite-link'
import { isOwnAccount, SELF_ACCESS_NOTE } from '../self-access'

/** Invitación pendiente de entregar, con el nombre de a quién pertenece. */
interface PendingInvite {
  username: string
  token: string
  expiresAt: string
  /** `true` cuando viene de reinvitar: el copy tiene que decir que la anterior quedó inválida. */
  reissued: boolean
}

const TABS = ['users', 'pending', 'roles'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

export function GatewayUsersPage() {
  // La pestaña vive en la URL (`?tab=roles`), igual que en `AdminPage`: los selectores de rol
  // enlazan directo a la matriz, y un valor desconocido cae en el listado.
  //
  // Sin `access.admin` el listado es un 403 seguro, así que sin `?tab` se entra a «Roles y
  // capacidades», que sí le sirve (es `self.read`). La pestaña por defecto no se escribe en la URL.
  const [searchParams, setSearchParams] = useSearchParams()
  const canAdmin = useCapabilities().can(CAPABILITIES.accessAdmin)
  const defaultTab: Tab = canAdmin ? 'users' : 'roles'
  const tabParam = searchParams.get('tab')
  const tab: Tab = isTab(tabParam) ? tabParam : defaultTab
  const setTab = (next: Tab) => {
    setSearchParams((previous) => {
      const updated = new URLSearchParams(previous)
      if (next === defaultTab) updated.delete('tab')
      else updated.set('tab', next)
      return updated
    })
  }

  const { admin } = useSession()
  // La bandeja también es `access.admin` (la tiene solo `access_admin`). Se pide aun fuera de su
  // pestaña: el recuento de la pestaña es lo que la hace descubrible. Sin sesión cargada ni se
  // ofrece ni se pide: `can()` falla abierto y sería un 403 seguro para quien no administra accesos.
  const canReviewGrants = admin !== null && canAdmin
  const pendingCount = usePendingCapabilityGrants(canReviewGrants).data?.length
  const [page, setPage] = useState(1)
  const [size, setSize] = useState<number>(PAGINATION.defaultSize)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<GatewayUserOut | undefined>(undefined)
  const [invite, setInvite] = useState<PendingInvite | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = useGatewayUsers(
    { page, size },
    // Antes de que llegue la sesión `can()` falla abierto: sin esperarla, la lista se pediría igual
    // y sería un 403 seguro para quien no administra accesos.
    admin !== null && canAdmin && tab === 'users',
  )
  const reissue = useReissueGatewayUserInvite()
  const sessionUserId = admin?.id ?? null
  // El listado y sus acciones van detrás de `access.admin`; «Roles y capacidades» no (es
  // `self.read`), así que la pestaña sigue sirviendo a quien solo quiere saber qué otorga un rol.
  const forbidden = !canAdmin || isAccessForbidden(error)

  const columns = useMemo<ColumnDef<GatewayUserOut>[]>(
    () => [
      {
        accessorKey: 'username',
        header: 'Usuario',
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono font-medium text-foreground">{row.original.username}</span>
              {isOwnAccount(sessionUserId, row.original) && <Badge tone="neutral">Tu cuenta</Badge>}
            </span>
            {row.original.full_name && (
              <span className="text-xs text-muted-foreground">{row.original.full_name}</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Correo',
        cell: ({ row }) =>
          // El servidor RELLENA el correo con `{username}@gateway.local` si el alta lo omite. Es
          // una dirección que nadie escribió y que no recibe correo: presentarla como dato de
          // contacto haría que alguien le escriba a una casilla inexistente.
          isSyntheticGatewayEmail(row.original) ? (
            <span className="text-xs italic text-muted-foreground">Sin correo declarado</span>
          ) : (
            <span className="text-muted-foreground">{row.original.email ?? '—'}</span>
          ),
      },
      {
        accessorKey: 'gateway_role',
        header: 'Rol',
        cell: ({ row }) => <AccessSummary user={row.original} />,
      },
      {
        id: 'estado',
        header: 'Estado',
        cell: ({ row }) => <AccountStateBadges user={row.original} />,
      },
      {
        accessorKey: 'last_login_at',
        header: 'Último acceso',
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.last_login_at ? formatDateTime(row.original.last_login_at) : 'Nunca'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const own = isOwnAccount(sessionUserId, row.original)
          return (
            <div className="flex flex-wrap items-center justify-end gap-1">
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
              {/*
                Acciones de dominio: conservan el texto, no se reducen a un icono.

                Sobre la propia cuenta «Accesos» va deshabilitado CON el motivo a la vista, no
                escondido: el backend rechaza el cambio (409 `access.self_modification_forbidden`).
                «Editar» sigue disponible porque los datos de contacto sí se pueden cambiar; el
                formulario deshabilita ahí el rol y el estado.
              */}
              {/* Navega a la página de accesos: es un `Link` con aspecto de botón, no un botón.
                  Un enlace no se puede deshabilitar, así que en la fila propia va un `Button`
                  deshabilitado en su lugar. */}
              {own ? (
                <Button variant="ghost" size="sm" disabled>
                  Accesos
                </Button>
              ) : (
                <Link
                  to={gatewayUserAccessPath(row.original.id)}
                  className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                >
                  Accesos
                </Link>
              )}
              {/*
                El botón DESAPARECE cuando la cuenta ya fijó su contraseña: sobre ella el endpoint
                responde 409 `credential_already_set`, porque la invitación es solo para la primera
                credencial. Para reemplazarla, la persona la cambia ella misma desde «Mi cuenta» →
                «Contraseña» (`POST /auth/password`, que exige la actual).
              */}
              {!row.original.credential_set && (
                <Button
                  variant="outline"
                  size="sm"
                  isLoading={reissue.isPending && reissue.variables === row.original.id}
                  onClick={() =>
                    reissue.mutate(row.original.id, {
                      onSuccess: (data) =>
                        setInvite({
                          username: row.original.username,
                          token: data.invite_token,
                          expiresAt: data.invite_expires_at,
                          reissued: true,
                        }),
                    })
                  }
                >
                  Reinvitar
                </Button>
              )}
              {own && (
                <p className="basis-full text-right text-xs text-muted-foreground">
                  {SELF_ACCESS_NOTE}
                </p>
              )}
            </div>
          )
        },
      },
    ],
    [reissue, sessionUserId],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usuarios del gateway"
        description="Identidades que se autentican contra el gateway. No son los usuarios de los motores de base de datos."
        actions={
          tab === 'users' && !forbidden ? (
            <Button
              onClick={() => {
                setEditing(undefined)
                setFormOpen(true)
              }}
            >
              Nuevo usuario
            </Button>
          ) : undefined
        }
      />

      <div
        className="flex gap-1 border-b border-border"
        role="tablist"
        aria-label="Secciones de usuarios del gateway"
      >
        {/* Sin `access.admin` la pestaña no se ofrece (como «Cifrado» en Administración): un
            enlace directo a `?tab=users` muestra el 403 compartido. */}
        {canAdmin && (
          <TabButton active={tab === 'users'} onClick={() => setTab('users')}>
            Usuarios
          </TabButton>
        )}
        {canReviewGrants && (
          <TabButton active={tab === 'pending'} onClick={() => setTab('pending')}>
            Solicitudes pendientes
            {pendingCount ? (
              <span className="ml-2 inline-flex">
                <Badge tone="warning">{pendingCount}</Badge>
              </span>
            ) : null}
          </TabButton>
        )}
        <TabButton active={tab === 'roles'} onClick={() => setTab('roles')}>
          Roles y capacidades
        </TabButton>
      </div>

      {tab === 'roles' ? (
        <RolesCapabilitiesPanel />
      ) : tab === 'pending' ? (
        canReviewGrants ? (
          <PendingCapabilityGrantsCard />
        ) : admin !== null ? (
          <ForbiddenState title="No tenés acceso a las solicitudes pendientes" />
        ) : null
      ) : forbidden ? (
        <ForbiddenState title="No tenés acceso a Usuarios del gateway" />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            isLoading={isLoading}
            isFetching={isFetching}
            searchPlaceholder="Buscar usuario…"
            emptyState={
              <EmptyState
                title="No hay usuarios del gateway"
                description="Creá una cuenta para que alguien más pueda iniciar sesión. La contraseña la elige esa persona, con un token de invitación."
              />
            }
          />
          {data && data.pagination.pages > 1 && (
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
          {/* El motivo de «Invitación pendiente» vivía en el `title` del badge, que no llega a
              teclado, lector de pantalla ni táctil. Va una vez, bajo la tabla, si aparece. */}
          <StatusLegend
            title="Qué significa cada estado"
            items={
              (data?.items ?? []).some((user) => !user.credential_set)
                ? [
                    {
                      key: 'pending',
                      label: 'Invitación pendiente',
                      tone: 'warning',
                      description:
                        'La cuenta existe pero todavía no puede iniciar sesión: falta que la persona elija su contraseña con el enlace de invitación.',
                    },
                  ]
                : []
            }
          />
        </>
      )}

      {formOpen && (
        <GatewayUserFormModal
          open
          user={editing}
          currentUserId={sessionUserId}
          onClose={() => setFormOpen(false)}
          onCreated={(created) => {
            // El modal de alta se cierra y da paso INMEDIATAMENTE a la entrega del token: es la
            // única vez que ese valor existe. Volver al listado acá dejaría la cuenta creada y sin
            // forma de entrar.
            setFormOpen(false)
            setInvite({
              username: created.username,
              token: created.invite_token,
              expiresAt: created.invite_expires_at,
              reissued: false,
            })
          }}
        />
      )}

      {invite && (
        <InviteDeliveryModal
          invite={invite}
          onDone={() => {
            setInvite(null)
            // El hook de reinvitar vive con el listado: sin `reset()` el token nuevo seguiría en
            // su `data` hasta la próxima reinvitación.
            reissue.reset()
          }}
        />
      )}
    </div>
  )
}

/**
 * Rol base, capacidades globales y cuántos permisos por alcance tiene. Sin las dos últimas, una
 * persona con `security_officer` o con cinco permisos de entorno se veía igual que un `viewer`
 * pelado: el listado escondía justo lo que más acceso da.
 */
function AccessSummary({ user }: { user: GatewayUserOut }) {
  const grants = user.scope_grants.length
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1">
        <Badge tone="info">{user.gateway_role}</Badge>
        {user.global_capabilities.map((capability) => (
          <Badge key={capability} tone="primary">
            {capability}
          </Badge>
        ))}
      </span>
      {grants > 0 && (
        <span className="text-xs text-muted-foreground">
          {grants === 1 ? '1 permiso por alcance' : `${grants} permisos por alcance`}
        </span>
      )}
    </div>
  )
}

/**
 * Estado de la cuenta. `credential_set: false` NO es lo mismo que inactiva, y por eso son dos
 * insignias y no un único campo: la cuenta puede estar activa y aun así no poder entrar porque
 * nadie fijó la contraseña. Colapsarlas haría que un administrador crea que la persona ya tiene
 * acceso, y el error se descubre recién cuando esa persona avisa que no puede entrar.
 */
function AccountStateBadges({ user }: { user: GatewayUserOut }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge tone={user.is_active ? 'success' : 'neutral'}>
        {user.is_active ? 'Activa' : 'Desactivada'}
      </Badge>
      {!user.credential_set && <Badge tone="warning">Invitación pendiente</Badge>}
    </div>
  )
}

function InviteDeliveryModal({ invite, onDone }: { invite: PendingInvite; onDone: () => void }) {
  return (
    <Modal
      open
      // `dismissible={false}`: no hay «✕» ni cierre por backdrop, y Esc ya lo decide el padre.
      // El único camino de salida es el botón del panel, detrás de la casilla de confirmación:
      // cerrar por reflejo perdería el token para siempre y dejaría la cuenta inutilizable.
      dismissible={false}
      onClose={() => undefined}
      title={
        invite.reissued
          ? `Nueva invitación para ${invite.username}`
          : `Usuario ${invite.username} creado`
      }
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {invite.reissued && (
          <Callout tone="info" title="La invitación anterior quedó inválida">
            Emitir una nueva revoca la anterior. Si la vieja se había filtrado, ya no sirve.
          </Callout>
        )}
        {/* Se entrega el LINK, no el token pelado: con el token solo, quien lo recibe no sabe
            dónde usarlo. El link ya lleva el token y abre la pantalla con el campo relleno. */}
        <OneTimeSecretPanel
          secretLabel="enlace de invitación"
          secret={buildInviteLink(invite.token)}
          expiresLabel={formatDateTime(invite.expiresAt)}
          consequence={`Si cerrás esto sin copiarlo, ${invite.username} no va a poder iniciar sesión y vas a tener que emitir otra invitación.`}
          handoffHint={`Entregáselo a ${invite.username} por el canal que corresponda. Al abrirlo elige su propia contraseña y recién ahí puede entrar.`}
          confirmLabel="Listo, volver al listado"
          onDone={onDone}
        />
      </div>
    </Modal>
  )
}
