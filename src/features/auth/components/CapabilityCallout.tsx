import type { ReactNode } from 'react'
import { Callout } from '@/components/ui'
import { useCapabilityCatalog } from '../hooks/use-capabilities'
import { capabilityName } from '../hooks/use-capability-guard'

/** Cierre fijo de todo aviso de acceso: la única salida real es pedirlo. */
export const ASK_FOR_ACCESS = 'Pedíselo a quien administra los accesos.'

interface CapabilityCalloutProps {
  /** Lo que SÍ puede hacer en esta pantalla, en infinitivo: «ver el estado y el historial». */
  canDo: string
  /** Lo que no, en infinitivo y sin «no»: «aplicar, revertir ni marcar versiones». */
  cannotDo: string
  /** Capacidades que faltan (de `guard.missing`, una o varias guardas juntas). */
  missing: readonly string[]
  /**
   * Con destino, la capa 2 todavía sin resolver (`guard.unresolved`): el aviso dice «se está
   * comprobando» o «no se pudo comprobar» en vez de afirmar que falta algo.
   */
  unresolved?: 'pending' | 'failed' | null
  /** Para el `aria-describedby` de cada control deshabilitado que este aviso explica. */
  id?: string
  className?: string
  /** Contexto propio de la pantalla («el snapshot se puede crear igual…»), después del motivo. */
  children?: ReactNode
}

/**
 * EL aviso de acceso de una pantalla: uno solo, arriba, en lugar de repetir el mismo motivo junto
 * a cada botón deshabilitado. Cinco «Tu acceso no permite…» iguales en una pantalla se dejan de
 * leer al segundo; uno que dice qué se puede, qué no y qué falta se lee una vez y alcanza.
 *
 * Cada control deshabilitado sigue apuntando acá con `aria-describedby={id}`: el lector de
 * pantalla oye el motivo al llegar al botón, aunque visualmente esté arriba. Las etiquetas de lo
 * que falta salen del catálogo; sin catálogo se muestra el id, nunca se inventa.
 *
 * No pinta nada cuando no falta nada.
 */
export function CapabilityCallout({
  canDo,
  cannotDo,
  missing,
  unresolved = null,
  id,
  className,
  children,
}: CapabilityCalloutProps) {
  const catalog = useCapabilityCatalog()
  if (missing.length === 0) return null
  const unique = [...new Set(missing)]

  if (unresolved !== null) {
    return (
      <Callout
        id={id}
        tone="info"
        className={className}
        title={
          unresolved === 'pending'
            ? `Comprobando si tu acceso permite ${cannotDo} en este destino…`
            : `No se pudo comprobar si tu acceso permite ${cannotDo} en este destino`
        }
      >
        <p>
          {unresolved === 'pending'
            ? 'Mientras tanto esas acciones quedan deshabilitadas.'
            : 'Esas acciones quedan deshabilitadas hasta saberlo. Recargá la página para volver a intentarlo.'}
        </p>
      </Callout>
    )
  }

  return (
    <Callout
      id={id}
      tone="info"
      className={className}
      title={`Podés ${canDo}, pero no ${cannotDo}`}
    >
      <p>
        {unique.length === 1 ? 'Tu acceso no incluye ' : 'Tu acceso no incluye estas capacidades: '}
        {unique.map((capability, index) => (
          <span key={capability}>
            {index > 0 && (index === unique.length - 1 ? ' ni ' : ', ')}
            {capabilityName(capability, catalog.data)}
          </span>
        ))}
        . {ASK_FOR_ACCESS}
      </p>
      {children}
    </Callout>
  )
}
