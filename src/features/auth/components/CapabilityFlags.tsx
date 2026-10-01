import type { ReactNode } from 'react'
import { Badge, EyeIcon, KeyIcon, PencilIcon, TrashIcon } from '@/components/ui'
import type { CapabilityDescriptor } from '@/lib/contracts'
import { CAPABILITY_FLAGS, capabilityFlagKeys, type CapabilityFlagKey } from '../capability-flags'

const ICONS: Partial<Record<CapabilityFlagKey, ReactNode>> = {
  destructive: <TrashIcon className="h-3 w-3" />,
  mutates: <PencilIcon className="h-3 w-3" />,
  discloses: <EyeIcon className="h-3 w-3" />,
  stepUp: <KeyIcon className="h-3 w-3" />,
}

interface CapabilityFlagsProps {
  capability: CapabilityDescriptor
  /**
   * Solo las marcas de riesgo (destructiva, modifica, divulga): para listas largas donde la
   * reautenticación y el uso por agentes son ruido.
   */
  compact?: boolean
}

/**
 * Las marcas de una capacidad. Icono + texto visible siempre: el riesgo de una capacidad no puede
 * vivir en un `title`, que no llega a un lector de pantalla ni existe en táctil.
 */
export function CapabilityFlags({ capability, compact = false }: CapabilityFlagsProps) {
  const keys = capabilityFlagKeys(capability, compact)
  if (keys.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {keys.map((key) => (
        <Badge key={key} tone={CAPABILITY_FLAGS[key].tone} className="px-2 py-0">
          {ICONS[key]}
          {CAPABILITY_FLAGS[key].label}
        </Badge>
      ))}
    </span>
  )
}
