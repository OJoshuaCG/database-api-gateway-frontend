import type { ReactNode } from 'react'
import { Badge } from '@/components/ui'
import type { RiskFlags } from '@/lib/contracts'
import { cn } from '@/lib/utils'

/**
 * Badges de riesgo de un ítem del diff. `possible_rename_of` y `requires_individual_review` son
 * las advertencias más peligrosas de la feature: se muestran como texto PERSISTENTE (no un
 * tooltip — este repo no tiene ese primitivo, y un hover tampoco funcionaría en móvil), nunca
 * solo como un badge que pase desapercibido.
 */
export function RiskFlagsBadgeRow({
  riskFlags,
  className,
}: {
  riskFlags: Partial<RiskFlags>
  className?: string
}) {
  const badges: ReactNode[] = []
  if (riskFlags.destructive) {
    badges.push(
      <Badge key="destructive" tone="error">
        🔴 Destructivo
      </Badge>,
    )
  }
  if (riskFlags.lock_heavy) {
    badges.push(
      <Badge key="lock_heavy" tone="warning">
        Lock pesado
      </Badge>,
    )
  }
  if (riskFlags.data_conversion) {
    badges.push(
      <Badge key="data_conversion" tone="warning">
        Conversión de datos
      </Badge>,
    )
  }
  if (riskFlags.needs_review) {
    badges.push(
      <Badge key="needs_review" tone="warning">
        Revisar
      </Badge>,
    )
  }
  if (riskFlags.cross_flavor_warning) {
    badges.push(
      <Badge key="cross_flavor_warning" tone="warning">
        MySQL↔MariaDB
      </Badge>,
    )
  }
  if (riskFlags.requires_individual_review) {
    badges.push(
      <Badge key="requires_individual_review" tone="info">
        🟣 Revisión individual
      </Badge>,
    )
  }

  if (badges.length === 0 && !riskFlags.possible_rename_of) return null

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {badges.length > 0 && <div className="flex flex-wrap gap-1.5">{badges}</div>}
      {riskFlags.possible_rename_of && (
        <p className="rounded-lg border border-warning/40 bg-warning/5 px-2.5 py-1.5 text-xs font-medium text-foreground">
          ⚠️ Posible RENAME de <code className="font-mono">{riskFlags.possible_rename_of}</code> —
          probablemente no sea una eliminación real.
        </p>
      )}
    </div>
  )
}
