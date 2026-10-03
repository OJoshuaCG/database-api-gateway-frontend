import { Badge } from '@/components/ui'
import type { ManagedDatabaseOut } from '@/lib/contracts'
import { AGENT_ACCESS_BADGE, resolveAgentAccessState } from '../agent-access'

/**
 * Estado de la base frente a los agentes MCP. Va en la celda del NOMBRE y no como columna: las
 * columnas son ocultables, y un estado de seguridad que se puede ocultar es uno que se deja de
 * mirar.
 */
export function AgentAccessBadge({ database }: { database: ManagedDatabaseOut }) {
  const { label, tone } = AGENT_ACCESS_BADGE[resolveAgentAccessState(database)]
  return <Badge tone={tone}>{label}</Badge>
}
