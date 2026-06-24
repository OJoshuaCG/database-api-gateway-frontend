import { useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { Input } from './Input'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  /** Si se indica, el usuario debe escribir esta palabra exacta para habilitar la acción. */
  confirmWord?: string
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  isLoading?: boolean
  children?: ReactNode
}

/**
 * Diálogo de confirmación. Para operaciones destructivas que tocan el motor destino,
 * `confirmWord` exige reescribir el nombre exacto del recurso (doble confirmación),
 * alineado con `confirm_name` / `confirm_username` del backend (§7, §9).
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmWord,
  confirmLabel = 'Confirmar',
  tone = 'danger',
  isLoading = false,
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')

  const requiresTyping = Boolean(confirmWord)
  const canConfirm = !requiresTyping || typed === confirmWord

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancelar
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={!canConfirm}
            isLoading={isLoading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {children}
        {requiresTyping && (
          <Input
            label={`Escribe «${confirmWord}» para confirmar`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label={`Escribe ${confirmWord} para confirmar`}
          />
        )}
      </div>
    </Modal>
  )
}
