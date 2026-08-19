import { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from 'react-error-boundary'
import { Spinner } from '@/components/ui'
import { cn } from '@/lib/utils'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { SectionErrorFallback } from './SectionErrorFallback'

const COLLAPSE_KEY = 'sidebar-collapsed'

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(COLLAPSE_KEY) === '1'
}

/** Layout principal de la app autenticada: sidebar + topbar + contenido con boundary. */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const location = useLocation()

  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div
      className={cn(
        'min-h-screen bg-background lg:grid',
        collapsed ? 'lg:grid-cols-[4.5rem_1fr]' : 'lg:grid-cols-[16rem_1fr]',
      )}
    >
      <aside className="hidden border-r border-border bg-surface lg:block">
        <div className="sticky top-0 h-screen overflow-y-auto">
          <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((value) => !value)} />
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            className="absolute inset-0 bg-overlay"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-64 border-r border-border bg-surface">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* `min-w-0`: como columna de un grid, su ancho mínimo automático es el del contenido.
          Sin esto, una tabla de resultados o un bloque de SQL anchos estiran la columna más
          allá del viewport y aparece scroll horizontal en TODA la página, en vez de quedarse
          dentro del contenedor con scroll propio que cada uno ya tiene. */}
      <div className="flex min-h-screen min-w-0 flex-col">
        <Topbar
          onMenuClick={() => setMobileOpen(true)}
          onToggleSidebar={() => setCollapsed((value) => !value)}
          sidebarCollapsed={collapsed}
        />
        {/* Sin tope de ancho: el margen fijo (`max-w-7xl`) dejaba una franja en blanco enorme al
            colapsar el sidebar, en vez de aprovechar el espacio que el colapso libera. El
            padding solo sigue existiendo para separar el contenido de los bordes de la
            ventana. */}
        <main className="w-full min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <ErrorBoundary FallbackComponent={SectionErrorFallback} resetKeys={[location.pathname]}>
            {/* Las vistas se cargan por ruta (`React.lazy` en el router): el fallback vive DENTRO
                del shell para que el sidebar y la topbar no parpadeen al navegar. */}
            <Suspense
              fallback={
                <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
                  <Spinner className="h-8 w-8" label="Cargando vista" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
