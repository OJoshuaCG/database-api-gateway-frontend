import type { ReactNode } from 'react'

/**
 * Botón de pestaña compartido. Precedente: `AdminPage` (Fase 0 de este patrón). Se extrae porque
 * había quedado triplicado con una divergencia real (`ServerUserDetailPage` sumaba `-mb-px`, que
 * desalinea el borde inferior activo respecto al de la barra) — usalo siempre dentro de un
 * contenedor `<div role="tablist" aria-label="Secciones de …" className="flex gap-1 border-b
 * border-border">`: sin `aria-label`, el lector de pantalla anuncia una lista de pestañas sin nombre.
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
      // Foco visible propio: sin él, recorrer las pestañas con teclado no deja rastro de dónde
      // está el foco (el subrayado marca la pestaña ACTIVA, no la enfocada).
      className={
        active
          ? 'border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary focus-visible:rounded-t-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
          : 'border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded-t-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
      }
    >
      {children}
    </button>
  )
}
