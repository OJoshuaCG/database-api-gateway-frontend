import { Link } from 'react-router-dom'
import { Callout } from '@/components/ui'
import { GATEWAY_USERS_PATH } from '@/lib/routes'
import { useSession } from '../hooks/use-session'
import { bootstrapWindowCopy, isBootstrapWindowOpen } from '../bootstrap-window'

/**
 * Aviso de la ventana de arranque (`/auth/me.bootstrap_window`, v29 §10.4) para quien administra
 * accesos. Lo monta el layout junto a `SodWarningsBanner`: es un estado de la instalación que
 * conviene ver desde cualquier pantalla hasta que se cierre.
 *
 * No se puede cerrar a propósito, igual que el de separación de deberes: desaparece cuando el
 * servidor cierra la ventana (segundo administrador de accesos con credencial, o vencimiento).
 */
export function BootstrapWindowBanner() {
  const { admin } = useSession()
  if (!isBootstrapWindowOpen(admin)) return null

  const copy = bootstrapWindowCopy(admin?.bootstrap_window?.closes_at)
  return (
    <Callout
      tone="warning"
      title={copy.title}
      className="mb-6"
      action={
        <Link to={GATEWAY_USERS_PATH} className="font-medium text-primary hover:underline">
          Ir a usuarios del gateway
        </Link>
      }
    >
      <p>{copy.body}</p>
    </Callout>
  )
}
