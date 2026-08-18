import type { ReactNode } from 'react'

/**
 * Botón de pestaña compartido. Precedente: `AdminPage` (Fase 0 de este patrón). Se extrae porque
 * había quedado triplicado con una divergencia real (`ServerUserDetailPage` sumaba `-mb-px`, que
 * desalinea el borde inferior activo respecto al de la barra) — usalo siempre dentro de un
 * contenedor `<div role="tablist" className="flex gap-1 border-b border-border">`.
 */
export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? 'border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary'
          : 'border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground'
      }
    >
      {children}
    </button>
  )
}
