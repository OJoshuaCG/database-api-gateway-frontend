import { AlertIcon } from '@/components/ui'
import { type EngineType } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { identityBannerText, identityTone, type IdentityDraft, type IdentityTone } from '../logic'

export interface IdentityBannerProps {
  identity: IdentityDraft
  engine: EngineType | null
}

/**
 * El tono es la señal continua, y por eso vive en un mapa y no repartido por el JSX: cambiar
 * de identidad tiene que cambiar el color de la franja de inmediato, sin depender de que
 * alguien lea el texto.
 */
const TONE_CLASS: Record<IdentityTone, string> = {
  danger: 'border-error/30 bg-error/10 text-error',
  primary: 'border-primary/30 bg-primary/10 text-primary',
  accent: 'border-accent/30 bg-accent/10 text-accent',
  neutral: 'border-border bg-surface-muted text-muted-foreground',
}

/**
 * Franja persistente con la identidad del motor con la que se va a ejecutar.
 *
 * Está siempre visible, no solo al elegir: la confusión que el módulo existe para evitar es
 * creer que se están probando permisos cuando en realidad se corre como pseudo-root, y esa
 * confusión aparece minutos después de haber elegido. El icono se reserva al tono `danger`
 * porque ponerlo en los cuatro tonos lo volvería decoración y dejaría de avisar de nada.
 */
export function IdentityBanner({ identity, engine }: IdentityBannerProps) {
  const tone = identityTone(identity.mode)

  return (
    <div
      role="status"
      className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', TONE_CLASS[tone])}
    >
      {tone === 'danger' && <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />}
      <p className="min-w-0">{identityBannerText(identity, engine)}</p>
    </div>
  )
}
