import { type BadgeTone, Badge } from '@/components/ui'
import type { PlanWarning, SchemaComparisonItemOut } from '@/lib/contracts'
import { opGroupObjectNames } from './logic'

/**
 * Codes conocidos de `plan_warnings` (§10.6). `code` es un string abierto: un code nuevo del
 * backend se renderiza igual (badge neutral con el code crudo), nunca se oculta el aviso.
 */
const KNOWN_CODES: Record<string, { label: string; tone: BadgeTone }> = {
  create_and_drop_same_object: { label: 'posible rename', tone: 'warning' },
  destructive_without_rollback: { label: 'sin rollback automático', tone: 'error' },
}

/**
 * Avisos de plan (§10.6) devueltos por adopt / execute-preview / execute — informativos, NO
 * bloqueantes: badge por code + el `message` del backend, mencionando el `op_group` afectado
 * cuando viene (resuelto a nombres de objeto si los ítems del diff están cargados).
 */
export function PlanWarningsList({
  warnings,
  items = [],
}: {
  warnings: PlanWarning[]
  /** Ítems del diff para traducir `op_group` → nombres de objeto legibles (opcional). */
  items?: SchemaComparisonItemOut[]
}) {
  if (warnings.length === 0) return null

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
      <p className="text-sm font-medium text-foreground">
        Avisos del plan ({warnings.length}) — no bloquean la operación
      </p>
      {warnings.map((warning, index) => {
        const known = KNOWN_CODES[warning.code]
        return (
          <div key={index} className="flex flex-wrap items-center gap-2 text-xs text-foreground">
            <Badge tone={known?.tone ?? 'neutral'}>{known?.label ?? warning.code}</Badge>
            <span>{warning.message}</span>
            {warning.op_group != null && warning.op_group !== '' && (
              <span className="text-muted-foreground">
                · afecta a: <strong>{opGroupObjectNames(items, warning.op_group).join(', ')}</strong>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
