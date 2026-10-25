import { type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/ui'
import { useCapabilityGuard, useStepUp, CapabilityHint } from '@/features/auth'
import { CAPABILITIES } from '@/lib/contracts'

interface DestructiveConfirmDialogProps {
  title: string
  description: string
  /**
   * Lo que hay que re-tipear: el nombre de la base (apply y rollback por base) o el slug del
   * entorno (apply-all). Viene del servidor (`confirm_name_expected` / `environment_slug`), no se
   * reconstruye en pantalla, para no confirmar contra un valor distinto del que va a validar.
   */
  confirmWord: string
  confirmLabel: string
  isLoading: boolean
  /** Alcance de la capa 2; sin él (apply-all) rige el rol base. */
  guardScope?: { serverId: number | null; environmentId: number | null }
  /** Corre YA con el step-up fresco. */
  onConfirm: () => void
  onClose: () => void
  children?: ReactNode
}

/**
 * Último paso antes de ejecutar SQL destructivo en un entorno protegido: re-tipear el nombre y,
 * si la sesión no está fresca, pasar por el step-up. Se monta solo mientras está abierto, así el
 * texto tipeado nunca sobrevive de una apertura a la siguiente.
 *
 * La capacidad se chequea acá además de en el servidor para que quien no puede ejecutar vea el
 * motivo en lugar de un 403 después de re-tipear.
 */
export function DestructiveConfirmDialog({
  title,
  description,
  confirmWord,
  confirmLabel,
  isLoading,
  guardScope,
  onConfirm,
  onClose,
  children,
}: DestructiveConfirmDialogProps) {
  const stepUp = useStepUp()
  const guard = useCapabilityGuard(
    CAPABILITIES.blueprintsApplyDestructive,
    'ejecutar migraciones destructivas',
    { scope: guardScope },
  )

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => stepUp.withFresh(CAPABILITIES.blueprintsApplyDestructive, onConfirm)}
      title={title}
      description={description}
      confirmWord={confirmWord}
      confirmLabel={confirmLabel}
      tone="danger"
      isLoading={isLoading}
      confirmDisabled={!guard.allowed}
      confirmDescribedBy={guard.describedBy}
    >
      {children}
      <CapabilityHint guard={guard} />
    </ConfirmDialog>
  )
}
