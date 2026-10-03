import { useState } from 'react'
import { useCapabilityCatalog } from '@/features/auth'

/** Techo de agente que ofrece el selector y de dónde salió. */
export interface AgentScopeCeiling {
  /** `null` cuando no hay catálogo ni techo informado: queda solo el campo libre. */
  offered: string[] | null
  /** `true` si lo informó un 422 `scope_not_allowed` en vez del catálogo en caché. */
  discovered: boolean
  /** Registra el techo que devolvió el servidor ante un 422 `scope_not_allowed`. */
  discover: (allowed: string[]) => void
}

/**
 * Techo de agente (`agent_allowed`, `GET /authz/catalog`). Se ofrece desde el principio, así nadie
 * tiene que adivinar un scope ni provocar el 422 para conocerlos. El campo libre se conserva: con
 * un backend que no publica el catálogo es la única forma de pedir uno.
 *
 * El techo que informó un 422 manda sobre el del catálogo porque es la respuesta del servidor a
 * ESTE pedido: si el catálogo en caché quedó viejo, este no.
 */
export function useAgentScopeCeiling(): AgentScopeCeiling {
  const [discoveredCeiling, setDiscoveredCeiling] = useState<string[] | null>(null)
  const catalog = useCapabilityCatalog()
  const catalogCeiling = (catalog.data ?? [])
    .filter((capability) => capability.agent_allowed)
    .map((capability) => capability.id)
  return {
    offered: discoveredCeiling ?? (catalogCeiling.length > 0 ? catalogCeiling : null),
    discovered: discoveredCeiling !== null,
    discover: setDiscoveredCeiling,
  }
}
