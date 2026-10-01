import { Link, useParams } from 'react-router-dom'
import { Badge, ChevronLeftIcon, ErrorState, PageHeader, Spinner } from '@/components/ui'
import { ForbiddenState, isAccessForbidden, useCapabilities, useSession } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import { CAPABILITIES } from '@/lib/contracts'
import { GATEWAY_USERS_PATH } from '@/lib/routes'
import { GatewayUserAccessEditor } from '../components/GatewayUserAccessEditor'
import { useGatewayUser } from '../hooks/use-gateway-users'
import { gatewayUserErrorMessage } from '../messages'
import { isOwnAccount } from '../self-access'

/**
 * `/gateway-users/:userId/accesos` — los accesos de un usuario del gateway en página propia.
 *
 * Era un modal y dejó de entrar: capacidades globales, permisos por alcance y el acceso efectivo
 * a la vez eran un diálogo con scroll interminable. Lee al usuario con `GET /gateway-users/{id}`
 * (`gateway.admin`), así que la URL sirve también escrita a mano o recargada.
 */
export function GatewayUserAccessPage() {
  const params = useParams()
  const userId = Number(params.userId)
  const isValidId = Number.isInteger(userId) && userId > 0
  const { admin, isLoading: sessionLoading } = useSession()
  const canAdmin = useCapabilities().can(CAPABILITIES.gatewayAdmin)
  // Antes de la sesión `can()` falla abierto: sin esperarla, el detalle se pediría igual y sería
  // un 403 seguro para quien no administra accesos.
  const user = useGatewayUser(userId, isValidId && admin !== null && canAdmin)

  const backLink = (
    <Link
      to={GATEWAY_USERS_PATH}
      className="inline-flex items-center gap-1 self-start rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeftIcon className="h-4 w-4" />
      Usuarios del gateway
    </Link>
  )

  const body = (() => {
    if (sessionLoading && admin === null) return <Loading />
    if (!canAdmin || isAccessForbidden(user.error)) {
      return <ForbiddenState title="No tenés acceso a los accesos de los usuarios del gateway" />
    }
    if (!isValidId) {
      return <ErrorState error={new Error('Identificador de usuario inválido.')} />
    }
    if (user.isError) {
      const apiError = toApiError(user.error)
      return (
        <ErrorState
          error={user.error}
          message={gatewayUserErrorMessage(apiError) ?? undefined}
          onRetry={() => void user.refetch()}
        />
      )
    }
    if (!user.data) return <Loading />
    return null
  })()

  if (body || !user.data) {
    return (
      <div className="flex flex-col gap-6">
        {backLink}
        <PageHeader title="Accesos" />
        {body}
      </div>
    )
  }

  const target = user.data
  return (
    <div className="flex flex-col gap-6">
      {backLink}
      <div className="flex flex-col gap-2">
        <PageHeader
          title={`Accesos de ${target.username}`}
          description="Capacidades globales y permisos por entorno o servidor."
        />
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {target.full_name && <span className="text-foreground">{target.full_name}</span>}
          <span className="inline-flex items-center gap-1">
            Rol base <Badge tone="info">{target.gateway_role}</Badge>
          </span>
          {!target.is_active && <Badge tone="neutral">Desactivada</Badge>}
        </div>
      </div>
      {/* `key`: el formulario se inicializa una vez con el estado completo de ESTA persona. */}
      <GatewayUserAccessEditor
        key={target.id}
        user={target}
        isSelf={isOwnAccount(admin?.id, target)}
      />
    </div>
  )
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Spinner className="h-4 w-4" /> Cargando los accesos…
    </div>
  )
}
