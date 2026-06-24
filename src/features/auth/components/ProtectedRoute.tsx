import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { FullPageSpinner } from '@/components/ui'
import { useSession } from '../hooks/use-session'

/** Guarda de rutas: redirige a /login si no hay sesión válida (§5). */
export function ProtectedRoute() {
  const { isLoading, isAuthenticated } = useSession()
  const location = useLocation()

  if (isLoading) return <FullPageSpinner label="Verificando sesión" />
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}
