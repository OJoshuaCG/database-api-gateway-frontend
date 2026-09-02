import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ErrorState, FullPageSpinner } from '@/components/ui'
import { useServerUser } from '../hooks/use-server-users'

/** Las pestañas de la vieja página tenían otros nombres que los de la ficha unificada. */
const OLD_TAB_TO_NEW: Record<string, string> = {
  effective: 'grants',
  manage: 'manage',
  // «Aplicar perfil» dejó de ser una pestaña propia: vive dentro de «Otorgar / revocar» (v21).
  profile: 'manage',
}

/**
 * Compatibilidad con enlaces guardados a `/server-users/:userId/grants` (Fase 2): la página de
 * permisos pasó a ser un grupo de pestañas de la ficha física de la identidad
 * (`ServerUserDetailPage`, ruta `/servers/:serverId/users/:username/:host?`). Esta página solo
 * resuelve `server_id`/`username`/`host` a partir del `id` de inventario y redirige — no puede
 * ser una entrada estática del router (como el redirect de `/privileges` en `router.tsx`) porque
 * antes necesita cargar el usuario.
 */
export function ServerUserGrantsPage() {
  const params = useParams()
  const userId = Number(params.userId)
  const isValidId = Number.isFinite(userId)
  const [searchParams] = useSearchParams()

  const user = useServerUser(userId, isValidId)

  if (!isValidId) {
    return <ErrorState error={new Error('Identificador de usuario inválido.')} />
  }
  if (user.isLoading) return <FullPageSpinner label="Redirigiendo a la ficha del usuario…" />
  if (user.isError || !user.data) {
    return <ErrorState error={user.error} onRetry={() => void user.refetch()} />
  }

  const oldTab = searchParams.get('tab')
  const newTab = (oldTab && OLD_TAB_TO_NEW[oldTab]) || 'grants'
  const hostSegment = user.data.host ? `/${encodeURIComponent(user.data.host)}` : ''
  const target = `/servers/${user.data.server_id}/users/${encodeURIComponent(user.data.username)}${hostSegment}?tab=${newTab}`

  return <Navigate to={target} replace />
}
