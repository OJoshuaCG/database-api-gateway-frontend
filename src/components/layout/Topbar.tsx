import { Link, useNavigate } from 'react-router-dom'
import { Button, SqlThemeSelect } from '@/components/ui'
import { useSession } from '@/features/auth/hooks/use-session'
import { useLogout } from '@/features/auth/hooks/use-logout'
import { HealthBadge } from '@/features/health/components/HealthBadge'
import { ThemeToggle } from './ThemeToggle'

interface TopbarProps {
  onMenuClick: () => void
  onToggleSidebar?: () => void
  sidebarCollapsed?: boolean
}

export function Topbar({ onMenuClick, onToggleSidebar, sidebarCollapsed }: TopbarProps) {
  const { admin } = useSession()
  const logout = useLogout()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => navigate('/login', { replace: true }),
    })
  }

  return (
    <header className="sticky top-0 z-20 flex h-[var(--topbar-h)] items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Abrir menú"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            aria-hidden
          >
            <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? 'Expandir menú lateral' : 'Comprimir menú lateral'}
            aria-pressed={sidebarCollapsed}
            title={sidebarCollapsed ? 'Expandir menú lateral' : 'Comprimir menú lateral'}
            className="hidden h-9 w-9 items-center justify-center rounded-lg border border-input text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              aria-hidden
            >
              <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth="1.6" />
              <path d="M9 4v16" strokeWidth="1.6" />
              <path
                d={sidebarCollapsed ? 'M13 10l2 2-2 2' : 'M16 10l-2 2 2 2'}
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
        <HealthBadge />
        {/* Junto al conmutador de tema: las dos son preferencias de apariencia y se buscan en
            el mismo sitio. Se oculta en pantallas estrechas, donde el selector a pantalla
            completa del propio visor de SQL cubre el caso. */}
        <SqlThemeSelect className="hidden lg:flex" hideLabel />
        <ThemeToggle />
        {admin && (
          // El nombre lleva a «Mi cuenta»: es donde la persona ve su acceso y sus sesiones, y
          // el destino del «Ver mi acceso» de cada 403. En pantallas estrechas el nombre no entra
          // y queda un icono con nombre accesible: «Mi cuenta» tiene que poder alcanzarse igual.
          <>
            <Link
              to="/mi-cuenta"
              aria-label={`Mi cuenta (${admin.username})`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                aria-hidden
              >
                <circle cx="12" cy="8" r="3.5" strokeWidth="1.6" />
                <path d="M5 20a7 7 0 0 1 14 0" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </Link>
            <Link
              to="/mi-cuenta"
              className="hidden rounded-md px-1 text-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline"
            >
              {admin.username}
            </Link>
          </>
        )}
        <Button variant="outline" size="sm" onClick={handleLogout} isLoading={logout.isPending}>
          Cerrar sesión
        </Button>
      </div>
    </header>
  )
}
