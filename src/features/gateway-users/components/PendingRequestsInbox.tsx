import { useSearchParams } from 'react-router-dom'
import { Callout, Spinner } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { AccessRequest } from '@/lib/contracts'
import { ACCESS_REQUEST_PARAM } from '@/lib/routes'
import { formatDateTime } from '@/lib/utils/format'
import { useAccessRequest } from '../hooks/use-access-requests'
import { ELEVATION_PENDING_MESSAGE, accessRequestErrorMessage } from '../messages'
import { PendingAccessRequestsCard } from './PendingAccessRequestsCard'
import { PendingCapabilityGrantsCard } from './PendingCapabilityGrantsCard'

/** Cómo terminó una solicitud que ya no está pendiente. Un estado nuevo se muestra tal cual. */
const CLOSED_LABELS: Record<string, string> = {
  applied: 'se aprobó y ya rige',
  rejected: 'se rechazó',
  cancelled: 'se canceló',
  expired: 'venció sin que nadie la decidiera',
}

/** El cierre automático, en palabras (`reason` cuando lo puso el sistema). */
const AUTO_REASONS: Record<string, string> = {
  expired: 'pasaron 7 días sin decisión',
  requester_lost_access: 'quien la pidió perdió access_admin',
  superseded: 'la reemplazó una solicitud más nueva sobre la misma persona',
  stale: 'el acceso de la persona cambió desde el pedido',
}

/** `?solicitud=abc` o `0` no es una solicitud: se ignora en vez de pedir un 404 seguro. */
function parseRequestId(raw: string | null): number | null {
  if (!raw) return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * La solicitud a la que se llegó desde el aviso de un `202` (`?solicitud=`), con su estado ACTUAL
 * (`GET /access-requests/{id}`): puede que otra persona ya la haya decidido entre el aviso y el
 * clic, y entonces no está en la bandeja. Fijo arriba porque el toast se va solo.
 */
function FocusedAccessRequest({ request }: { request: AccessRequest }) {
  if (request.status === 'pending') {
    return (
      <Callout tone="warning" title={`Elevación pendiente para ${request.target.username}`}>
        <p>{ELEVATION_PENDING_MESSAGE}</p>
        {request.expires_at && (
          <p className="mt-1">Vence el {formatDateTime(request.expires_at)} si nadie la decide.</p>
        )}
      </Callout>
    )
  }
  const auto = request.reason ? AUTO_REASONS[request.reason] : undefined
  return (
    <Callout tone="info" title={`La solicitud de ${request.target.username} ya no está pendiente`}>
      <p>
        La elevación {CLOSED_LABELS[request.status] ?? `está en estado «${request.status}»`}
        {request.decided_by ? ` (${request.decided_by.username})` : ''}
        {auto ? `: ${auto}` : request.reason ? `. Motivo: ${request.reason}` : ''}.
      </p>
    </Callout>
  )
}

/**
 * Pestaña «Solicitudes pendientes» de `/gateway-users`: las DOS bandejas del segundo aprobador.
 *
 * - **Elevaciones de acceso** (`/access-requests`, v29 §9): rol `owner`, globales y `sod_override`
 *   que nacieron de un alta, una edición o un cambio de accesos.
 * - **Capacidades puntuales** (`/capability-grants/pending`): las sensibles y las que traen
 *   `sod_override`.
 *
 * Van en dos secciones y no mezcladas: se deciden con endpoints distintos, muestran cosas distintas
 * (un cambio de acceso completo contra una capacidad en un destino) y sus errores no se parecen.
 * Quien monta esto ya comprobó `access.admin`.
 */
export function PendingRequestsInbox() {
  const [searchParams] = useSearchParams()
  const focusId = parseRequestId(searchParams.get(ACCESS_REQUEST_PARAM))
  const focused = useAccessRequest(focusId)

  return (
    <div className="flex flex-col gap-6">
      {focusId !== null &&
        (focused.isLoading ? (
          <Spinner label="Cargando la solicitud…" />
        ) : focused.data ? (
          <FocusedAccessRequest request={focused.data} />
        ) : focused.isError ? (
          <Callout tone="warning" title="No se pudo cargar esa solicitud">
            {accessRequestErrorMessage(toApiError(focused.error)) ??
              toApiError(focused.error).message}
          </Callout>
        ) : null)}
      <PendingAccessRequestsCard focusId={focusId} />
      <PendingCapabilityGrantsCard />
    </div>
  )
}
