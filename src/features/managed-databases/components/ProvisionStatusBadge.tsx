import { Badge, type BadgeTone } from '@/components/ui'
import type { ProvisionStatus } from '@/lib/contracts'

const MAP: Record<ProvisionStatus, { tone: BadgeTone; label: string }> = {
  pending: { tone: 'warning', label: 'Pendiente' },
  active: { tone: 'success', label: 'Activa' },
  error: { tone: 'error', label: 'Error' },
  archived: { tone: 'neutral', label: 'Archivada' },
}

export function ProvisionStatusBadge({ status }: { status: ProvisionStatus }) {
  const { tone, label } = MAP[status]
  return <Badge tone={tone}>{label}</Badge>
}
