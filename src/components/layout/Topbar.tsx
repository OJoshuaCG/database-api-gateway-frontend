import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui'
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
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Abrir menú"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-input text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" aria-hidden>
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
            className="hidden h-10 w-10 items-center justify-center rounded-lg border border-input text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex"
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
        <ThemeToggle />
        {admin && (
          <span className="hidden text-sm text-muted-foreground sm:inline">{admin.username}</span>
        )}
        <Button variant="outline" size="sm" onClick={handleLogout} isLoading={logout.isPending}>
          Cerrar sesión
        </Button>
      </div>
    </header>
  )
}
