import { CAPABILITIES, type AdminOut } from '@/lib/contracts'
import { formatSodInstant } from './separation-of-duties'

/**
 * Ventana de arranque de los accesos (C4, api-reference-v29 §10): mientras está abierta y quien
 * pide es el ÚNICO `access_admin` con credencial, sus elevaciones se aplican en el acto en vez de
 * esperar a un segundo aprobador.
 */

/**
 * ¿La sesión administra accesos con la ventana de arranque abierta? El backend ya manda `null` a
 * quien no tiene `access.admin`; se vuelve a mirar la capacidad para que un `open` suelto nunca le
 * muestre el aviso a otra persona. El cierre lo decide el servidor (lo evalúa en cada `/auth/me`):
 * acá no se compara `closes_at` con el reloj.
 */
export function isBootstrapWindowOpen(admin: AdminOut | null | undefined): boolean {
  if (!admin?.bootstrap_window?.open) return false
  return admin.capabilities.includes(CAPABILITIES.accessAdmin)
}

/** Texto del aviso. Sin `closes_at` se omite la fecha en lugar de inventar una. */
export function bootstrapWindowCopy(closesAt: string | null | undefined): {
  title: string
  body: string
} {
  const until = closesAt ? ` hasta el ${formatSodInstant(closesAt)}` : ''
  return {
    title: 'Ventana de arranque abierta',
    body: `Ventana de arranque abierta${until}. Mientras seas el único administrador de accesos, tus elevaciones se aplican sin segundo aprobador. Creá un oficial de seguridad, un owner y un segundo administrador de accesos; cuando este acepte su invitación, la ventana se cierra.`,
  }
}

/** Nota junto a «Requiere segundo aprobador» mientras la ventana está abierta. */
export const BOOTSTRAP_WINDOW_BADGE_NOTE = '(se aplica directo durante la ventana de arranque)'
