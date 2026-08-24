import { Badge, type BadgeTone } from '@/components/ui'
import type { ProvisionStatus } from '@/lib/contracts'

const MAP: Record<ProvisionStatus, { tone: BadgeTone; label: string; hint: string }> = {
  // «Pendiente» a secas no dice lo importante: la base NO existe en el servidor. Sin el matiz
  // se lee como "en curso" y el operador espera a que se resuelva sola.
  pending: {
    tone: 'warning',
    label: 'Pendiente',
    hint: 'Registrada en el inventario; todavía no existe en el motor.',
  },
  active: { tone: 'success', label: 'Activa', hint: 'Creada y aprovisionada en el motor.' },
  error: {
    tone: 'error',
    label: 'Error',
    hint: 'Falló al crearse en el motor, o quedó en cuarentena por una migración fallida.',
  },
  archived: {
    tone: 'neutral',
    label: 'Archivada',
    hint: 'Retirada del uso sin borrarse del inventario.',
  },
}

export function ProvisionStatusBadge({ status }: { status: ProvisionStatus }) {
  const { tone, label, hint } = MAP[status]
  return (
    <Badge tone={tone} title={hint}>
      {label}
    </Badge>
  )
}
