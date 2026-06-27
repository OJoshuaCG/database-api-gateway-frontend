import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

const iconClass = 'h-5 w-5 shrink-0'

const NAV_ITEMS: NavItem[] = [
  {
    to: '/servers',
    label: 'Servidores',
    icon: (
      <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" aria-hidden>
        <rect x="3" y="4" width="18" height="6" rx="1.5" strokeWidth="1.6" />
        <rect x="3" y="14" width="18" height="6" rx="1.5" strokeWidth="1.6" />
        <path d="M7 7h.01M7 17h.01" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/server-users',
    label: 'Usuarios del motor',
    icon: (
      <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" aria-hidden>
        <circle cx="9" cy="8" r="3" strokeWidth="1.6" />
        <path
          d="M3.5 19a5.5 5.5 0 0 1 11 0M16 11a3 3 0 1 0-2-5.2M20.5 19a5.5 5.5 0 0 0-4-5.3"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    to: '/database-models',
    label: 'Blueprints',
    icon: (
      <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" aria-hidden>
        <rect x="4" y="4" width="7" height="7" rx="1.5" strokeWidth="1.6" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" strokeWidth="1.6" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" strokeWidth="1.6" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    to: '/managed-databases',
    label: 'Bases de datos',
    icon: (
      <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" aria-hidden>
        <ellipse cx="12" cy="5.5" rx="7" ry="2.5" strokeWidth="1.6" />
        <path
          d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
  {
    to: '/privileges',
    label: 'Privilegios',
    icon: (
      <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" aria-hidden>
        <path
          d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M9 12l2 2 4-4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/permission-profiles',
    label: 'Perfiles de permisos',
    icon: (
      <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" aria-hidden>
        <path d="M9 12h6M9 16h6M9 8h6" strokeWidth="1.6" strokeLinecap="round" />
        <rect x="4" y="3" width="16" height="18" rx="2" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    to: '/admin',
    label: 'Administración',
    icon: (
      <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" aria-hidden>
        <circle cx="12" cy="12" r="3" strokeWidth="1.6" />
        <path
          d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
]

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex h-full flex-col gap-1 p-4" aria-label="Navegación principal">
      <div className="mb-4 flex items-center gap-2 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            aria-hidden
          >
            <ellipse cx="12" cy="5.5" rx="7" ry="2.5" strokeWidth="1.8" />
            <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" strokeWidth="1.8" />
          </svg>
        </span>
        <span className="text-sm font-semibold text-foreground">DB Gateway</span>
      </div>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
            )
          }
        >
          {item.icon}
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
