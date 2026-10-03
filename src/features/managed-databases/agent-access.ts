import type { BadgeTone } from '@/components/ui'

/**
 * Estado de una base frente al acceso de agentes (MCP), derivado de los dos flags del contrato.
 *
 * `blocked` se evalúa PRIMERO porque gana sobre `allowed` y no tiene override: una base con los
 * dos encendidos está bloqueada, y pintarla «abierta» prometería un acceso que el gate niega.
 */
export type AgentAccessState = 'closed' | 'open' | 'blocked'

export function resolveAgentAccessState(db: {
  agent_access_allowed: boolean
  agent_access_blocked: boolean
}): AgentAccessState {
  if (db.agent_access_blocked) return 'blocked'
  return db.agent_access_allowed ? 'open' : 'closed'
}

/**
 * Texto y tono de cada estado. «Abierta» va en `warning`: es la que expone la base a terceros, y
 * «cerrada» es el valor normal, así que va neutra para no ensuciar el listado. Es una condición
 * PARCIAL (el entorno también tiene que estar abierto), y la etiqueta no dice «accesible».
 */
export const AGENT_ACCESS_BADGE: Record<AgentAccessState, { label: string; tone: BadgeTone }> = {
  closed: { label: 'Cerrada a agentes', tone: 'neutral' },
  open: { label: 'Abierta a agentes', tone: 'warning' },
  blocked: { label: 'Bloqueada para agentes', tone: 'error' },
}
