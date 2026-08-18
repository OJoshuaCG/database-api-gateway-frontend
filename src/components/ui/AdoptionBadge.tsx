import { Badge } from './Badge'

/**
 * Estado de una entidad física (base de datos o identidad de usuario del motor) frente al
 * inventario del gateway: `adopted` está registrada, `unmanaged` existe en el motor pero no en
 * el inventario, `orphan` existe en el inventario pero ya no en el motor. Las bases de datos
 * nunca llegan a `orphan` (no hay flujo que lo produzca), pero comparten el mismo tipo para que
 * un solo componente sirva a las tres pantallas que muestran este estado.
 */
export type AdoptionStatus = 'adopted' | 'unmanaged' | 'orphan'

const ADOPTION_BADGE: Record<
  AdoptionStatus,
  { tone: 'success' | 'warning' | 'error'; label: string }
> = {
  adopted: { tone: 'success', label: 'Adoptada' },
  unmanaged: { tone: 'warning', label: 'No adoptada' },
  orphan: { tone: 'error', label: 'Huérfana' },
}

/**
 * Badge único para "está en el inventario del gateway": mismo texto, mismo tono, en las tres
 * pantallas que cruzan una entidad física contra el inventario (`ServerDatabaseDetailPage`,
 * `EngineUsersPanel`, `ServerUserDetailPage`). Antes cada una tenía su propio vocabulario
 * («Gestionada»/«No gestionada», «🟢 Adoptado»/«🟡 Sin adoptar»/«🔴 Huérfano», «📥 adoptada»);
 * esto evita que vuelvan a divergir.
 */
export function AdoptionBadge({
  status,
  className,
}: {
  status: AdoptionStatus
  className?: string
}) {
  const { tone, label } = ADOPTION_BADGE[status]
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  )
}
