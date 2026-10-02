import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
} from '@/components/ui'
import { ForbiddenState, isAccessForbidden, MY_SESSIONS_PATH } from '@/features/auth'
import type { GatewayUserOut, GatewayUserSession } from '@/lib/contracts'
import { formatUtcDateTime } from '@/lib/utils/format'
import { useGatewayUserSessions, useRevokeGatewayUserSessions } from '../hooks/use-gateway-users'

export interface GatewayUserSessionsSectionProps {
  user: Pick<GatewayUserOut, 'id' | 'username'>
  /** La cuenta de la sesión actual: el backend responde 409 si se intenta sobre ella. */
  isSelf: boolean
}

/**
 * «Sesiones activas» de otra persona (api-reference-v29 §11.5–11.6). Solo `access_admin`: el editor
 * la monta únicamente con `access.admin`, así que con otro rol no existe ni dispara la consulta.
 *
 * Es la pieza que faltaba para cortar el acceso de alguien **sin** cambiarle el rol ni desactivarlo:
 * una sospecha de sesión robada se resuelve acá en un paso. No toca la contraseña: si está
 * comprometida, esto va junto con desactivar la cuenta, y la descripción lo dice.
 *
 * Las sesiones vienen **sin `sid`** (es la credencial), así que no se cierra una por una: el botón las
 * cierra todas. Pide step-up, que el cliente resuelve solo antes de reenviar.
 */
export function GatewayUserSessionsSection({ user, isSelf }: GatewayUserSessionsSectionProps) {
  const headingId = useId()
  const selfHintId = useId()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const sessions = useGatewayUserSessions(user.id)
  const revoke = useRevokeGatewayUserSessions(user.id, user.username)
  const items = sessions.data ?? []

  const columns = useMemo<ColumnDef<GatewayUserSession>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: 'Iniciada',
        cell: ({ row }) => formatUtcDateTime(row.original.created_at),
      },
      {
        accessorKey: 'last_seen_at',
        header: 'Última actividad',
        cell: ({ row }) => formatUtcDateTime(row.original.last_seen_at),
      },
      {
        accessorKey: 'expires_at',
        header: 'Vence a más tardar',
        cell: ({ row }) => formatUtcDateTime(row.original.expires_at),
      },
      {
        accessorKey: 'ip',
        header: 'IP',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.ip ?? '—'}</span>
        ),
      },
    ],
    [],
  )

  const body = (() => {
    if (isAccessForbidden(sessions.error)) {
      return <ForbiddenState title="No tenés acceso a las sesiones de esta persona" />
    }
    if (sessions.isError) {
      return (
        <ErrorState
          error={sessions.error}
          title="No se pudieron cargar las sesiones"
          onRetry={() => void sessions.refetch()}
        />
      )
    }
    return (
      <DataTable
        data={items}
        columns={columns}
        isLoading={sessions.isLoading}
        isFetching={sessions.isFetching}
        enableGlobalFilter={false}
        enableColumnVisibility={false}
        emptyState={
          <EmptyState
            title="No tiene sesiones abiertas"
            description={`${user.username} no tiene ninguna sesión viva en este momento.`}
          />
        }
      />
    )
  })()

  return (
    <Card>
      <section aria-labelledby={headingId}>
        <CardHeader>
          <h2 id={headingId} className="text-base font-semibold text-foreground">
            Sesiones activas
          </h2>
          <p className="text-sm text-muted-foreground">
            Dónde tiene {user.username} la cuenta abierta ahora. Cerrarlas no cambia su contraseña
            ni su acceso: si la contraseña está comprometida, desactivá además la cuenta. Una sesión
            puede caer antes del vencimiento por inactividad.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {body}

          {items.length > 0 && (
            <div className="flex flex-col items-end gap-2 border-t border-border pt-4">
              {/* Acción de dominio y destructiva: conserva el texto. Abre la confirmación en rojo. */}
              <Button
                variant="danger-soft"
                onClick={() => setConfirmOpen(true)}
                disabled={isSelf}
                aria-describedby={isSelf ? selfHintId : undefined}
              >
                Cerrar todas las sesiones
              </Button>
              {isSelf && (
                <p id={selfHintId} className="text-right text-xs text-muted-foreground">
                  Es tu propia cuenta: cerrá tus otras sesiones desde{' '}
                  <Link
                    to={MY_SESSIONS_PATH}
                    className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Mi cuenta
                  </Link>
                  , que conserva la de esta pestaña.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </section>

      {confirmOpen && (
        <ConfirmDialog
          open
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => revoke.mutate(undefined, { onSettled: () => setConfirmOpen(false) })}
          title={`Cerrar todas las sesiones de ${user.username}`}
          description="Se cerrarán todas sus sesiones abiertas y va a tener que volver a iniciar sesión. No cambia su contraseña ni su acceso."
          confirmLabel="Cerrar sesiones"
          isLoading={revoke.isPending}
        />
      )}
    </Card>
  )
}
