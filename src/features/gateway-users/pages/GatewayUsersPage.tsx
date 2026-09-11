import { useMemo, useState } from 'react'
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
} from '@/components/ui'
import { useSession } from '@/features/auth'
import { PAGINATION, isSyntheticGatewayEmail, type GatewayUserOut } from '@/lib/contracts'
import { formatDateTime } from '@/lib/utils'
import { GatewayUserAccessModal } from '../components/GatewayUserAccessModal'
import { GatewayUserFormModal } from '../components/GatewayUserFormModal'
import { useGatewayUsers, useReissueGatewayUserInvite } from '../hooks/use-gateway-users'

/** Invitación pendiente de entregar, con el nombre de a quién pertenece. */
interface PendingInvite {
  username: string
  token: string
  expiresAt: string
  /** `true` cuando viene de reinvitar: el copy tiene que decir que la anterior quedó inválida. */
  reissued: boolean
}

export function GatewayUsersPage() {
  const { admin } = useSession()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState<number>(PAGINATION.defaultSize)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<GatewayUserOut | undefined>(undefined)
  const [accessTarget, setAccessTarget] = useState<GatewayUserOut | null>(null)
  const [invite, setInvite] = useState<PendingInvite | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = useGatewayUsers({ page, size })
  const reissue = useReissueGatewayUserInvite()

  const columns = useMemo<ColumnDef<GatewayUserOut>[]>(
    () => [
      {
        accessorKey: 'username',
        header: 'Usuario',
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono font-medium text-foreground">{row.original.username}</span>
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
        cell: ({ row }) => <Badge tone="info">{row.original.gateway_role}</Badge>,
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
        cell: ({ row }) => (
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
            {/* Acciones de dominio: conservan el texto, no se reducen a un icono. */}
            <Button variant="ghost" size="sm" onClick={() => setAccessTarget(row.original)}>
              Accesos
            </Button>
            {/*
              El botón DESAPARECE cuando la cuenta ya fijó su contraseña: sobre ella el endpoint
              responde 409 `credential_already_set`, porque la invitación es solo para la primera
              credencial. Para reemplazarla, la persona la cambia desde su propia sesión.
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
          </div>
        ),
      },
    ],
    [reissue],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usuarios del gateway"
        description="Identidades que se autentican contra el gateway. No son los usuarios de los motores de base de datos."
        actions={
          <Button
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            Nuevo usuario
          </Button>
        }
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
        </>
      )}

      {formOpen && (
        <GatewayUserFormModal
          open
          user={editing}
          currentUsername={admin?.username ?? null}
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

      {accessTarget && (
        <GatewayUserAccessModal user={accessTarget} onClose={() => setAccessTarget(null)} />
      )}

      {invite && <InviteDeliveryModal invite={invite} onDone={() => setInvite(null)} />}
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
      {!user.credential_set && (
        <Badge tone="warning" title="La cuenta existe pero todavía no puede iniciar sesión.">
          Invitación pendiente
        </Badge>
      )}
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
        <OneTimeSecretPanel
          secretLabel="token de invitación"
          secret={invite.token}
          expiresLabel={formatDateTime(invite.expiresAt)}
          consequence={`Si cerrás esto sin copiarlo, ${invite.username} no va a poder iniciar sesión y vas a tener que emitir otra invitación.`}
          handoffHint={`Entregáselo a ${invite.username} por el canal que corresponda. Con él elige su propia contraseña y recién ahí puede entrar.`}
          confirmLabel="Listo, volver al listado"
          onDone={onDone}
        />
      </div>
    </Modal>
  )
}
