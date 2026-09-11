import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Spinner,
} from '@/components/ui'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import { formatDateTime } from '@/lib/utils'
import { listSessions, revokeOtherSessions } from '../api/auth.api'
import { useSession } from '../hooks/use-session'

/**
 * Sesiones vivas del propio usuario (api-reference-v23 §7.4).
 *
 * Es una pantalla de **autoservicio de seguridad**: sirve para que alguien note una sesión que no
 * reconoce y la corte sin depender de un administrador. Por eso muestra IP y última actividad, que
 * son los dos datos con los que una persona reconoce —o no— una sesión propia.
 *
 * `sid_prefix` es un PREFIJO y nunca el identificador completo: el identificador de sesión ES la
 * credencial, y publicarlo entero convertiría esta pantalla en el robo de sesión que ayuda a
 * detectar. Alcanza para distinguir filas entre sí, que es todo lo que hace falta acá.
 */
export function SessionsPanel() {
  const { admin } = useSession()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const sessions = useQuery({
    queryKey: queryKeys.auth.sessions(),
    queryFn: ({ signal }) => listSessions(signal),
  })

  const revokeOthers = useMutation({
    mutationFn: () => revokeOtherSessions(),
    onSuccess: (message) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions() })
      toast.success(message ?? 'Se cerraron las demás sesiones', 'La actual sigue abierta.')
      setConfirmOpen(false)
    },
    onError: (error) =>
      toast.error('No se pudieron cerrar las demás sesiones', toApiError(error).message),
  })

  const others = (sessions.data ?? []).filter((item) => !item.current).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tus sesiones abiertas</CardTitle>
        <CardDescription>
          Dónde está abierta tu cuenta ahora mismo. Si ves una que no reconocés, cerrá las demás y
          cambiá tu contraseña.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/*
          El cambio de comportamiento que más va a sorprender (§7.3): antes la sesión no expiraba
          nunca mientras hubiera actividad. Decirlo acá, donde el usuario ya está pensando en sus
          sesiones, es más útil que descubrirlo cuando lo echa a mitad de una operación.
        */}
        <Callout tone="info" title="Las sesiones ahora vencen solas">
          Cada sesión dura como máximo <strong>12 horas</strong> desde que iniciás —haya actividad o
          no— y se cierra tras <strong>60 minutos</strong> sin uso. Guardá tu trabajo antes de dejar
          la pestaña abierta mucho tiempo.
        </Callout>

        {admin?.previous_login_at && (
          <p className="text-xs text-muted-foreground">
            Tu acceso anterior fue el{' '}
            <span className="font-medium text-foreground">
              {formatDateTime(admin.previous_login_at)}
            </span>
            {admin.last_failed_at && (
              <>
                {' '}
                · último intento fallido:{' '}
                <span className="font-medium text-foreground">
                  {formatDateTime(admin.last_failed_at)}
                </span>
              </>
            )}
            .
          </p>
        )}

        {sessions.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando tus sesiones…
          </div>
        ) : sessions.isError ? (
          <ErrorState
            error={sessions.error}
            title="No se pudieron cargar tus sesiones"
            onRetry={() => void sessions.refetch()}
          />
        ) : (sessions.data ?? []).length === 0 ? (
          <EmptyState
            title="No hay sesiones para mostrar"
            description="El gateway no reportó ninguna sesión abierta."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Sesión</th>
                  <th className="pb-2 pr-4 font-medium">Iniciada</th>
                  <th className="pb-2 pr-4 font-medium">Última actividad</th>
                  <th className="pb-2 pr-4 font-medium">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(sessions.data ?? []).map((item) => (
                  <tr key={item.sid_prefix}>
                    <td className="py-2 pr-4">
                      <span className="flex flex-wrap items-center gap-2">
                        <code className="font-mono text-xs text-muted-foreground">
                          {item.sid_prefix}…
                        </code>
                        {item.current && <Badge tone="success">esta pestaña</Badge>}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {formatDateTime(item.created_at)}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {item.last_seen_at ? formatDateTime(item.last_seen_at) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{item.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {others > 0 && (
          <div className="flex justify-end border-t border-border pt-4">
            {/* Acción de dominio: conserva el texto y lleva el contador, que es lo que convierte
                «cerrar las demás» en una decisión informada. */}
            <Button variant="danger-soft" onClick={() => setConfirmOpen(true)}>
              Cerrar las otras {others} sesión(es)
            </Button>
          </div>
        )}
      </CardContent>

      {confirmOpen && (
        <ConfirmDialog
          open
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => revokeOthers.mutate()}
          title="Cerrar las demás sesiones"
          description={`Se cerrarán ${others} sesión(es) y la de esta pestaña seguirá abierta. Quien las estuviera usando va a tener que iniciar sesión de nuevo.`}
          confirmLabel="Cerrar las demás"
          isLoading={revokeOthers.isPending}
        />
      )}
    </Card>
  )
}
