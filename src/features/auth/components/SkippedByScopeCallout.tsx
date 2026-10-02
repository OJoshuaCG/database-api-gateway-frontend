import { Callout } from '@/components/ui'
import { ASK_FOR_ACCESS } from './CapabilityCallout'

interface SkippedByScopeCalloutProps {
  /** Ids de los ítems omitidos tal como el backend los devolvió (`id` de fila o de base). */
  ids: readonly number[]
  /** Qué son, en singular y femenino: «base», «fila». */
  noun: string
  className?: string
}

/**
 * Aviso de un lote que omitió ítems por falta de alcance en su entorno o servidor.
 *
 * El lote NO falló: corrió con lo permitido. Por eso es `warning` y no `danger`, y por eso dice
 * qué pasó con lo omitido (no se tocó, no se cuenta) antes de decir cómo salir. Lista solo ids:
 * el backend no manda nombres de lo que el actor no puede tocar.
 */
export function SkippedByScopeCallout({ ids, noun, className }: SkippedByScopeCalloutProps) {
  if (ids.length === 0) return null
  const plural = ids.length === 1 ? '' : 's'
  return (
    <Callout
      tone="warning"
      className={className}
      title={`${ids.length} ${noun}${plural} omitida${plural} por falta de permiso`}
    >
      <p>
        Tu acceso no alcanza el entorno de {ids.length === 1 ? 'esta' : 'estas'} {noun}
        {plural}, así que no se ejecutó nada sobre {ids.length === 1 ? 'ella' : 'ellas'} ni cuentan
        en el resultado: {ids.map((id) => `#${id}`).join(', ')}. {ASK_FOR_ACCESS}
      </p>
    </Callout>
  )
}
