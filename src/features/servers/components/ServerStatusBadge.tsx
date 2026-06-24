import { Badge, type BadgeTone } from '@/components/ui'
import type { ServerStatus } from '@/lib/contracts'

const MAP: Record<ServerStatus, { tone: BadgeTone; label: string }> = {
  active: { tone: 'success', label: 'Activo' },
  inactive: { tone: 'neutral', label: 'Inactivo' },
  unreachable: { tone: 'error', label: 'Inalcanzable' },
}

export function ServerStatusBadge({ status }: { status: ServerStatus }) {
  const { tone, label } = MAP[status]
  return <Badge tone={tone}>{label}</Badge>
}
