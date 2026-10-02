import { useId, useState, type FormEvent } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { StepUpOut } from '@/lib/contracts'
import { useConfirmStepUp } from '../hooks/use-confirm-step-up'
import { STEP_UP_EXPLANATION, stepUpErrorMessage } from '../messages'

export interface StepUpDialogProps {
  /** El servidor abrió la ventana. */
  onConfirmed: (result: StepUpOut) => void
  /** La persona canceló, o la sesión murió mientras preguntábamos. */
  onCancel: () => void
}

/**
 * Pedido de contraseña del step-up (`POST /auth/step-up`). Se monta condicionalmente, uno por
 * pedido, así arranca vacío sin `setState` en efectos.
 *
 * El error queda FIJO en el diálogo y no en un toast: la persona tiene que leer cuántos intentos le
 * quedan antes de volver a tipear, porque el quinto fallo seguido cierra la sesión.
 */
export function StepUpDialog({ onConfirmed, onCancel }: StepUpDialogProps) {
  const confirm = useConfirmStepUp()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const formId = useId()

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!password || confirm.isPending) return
    setError(null)
    confirm.mutate(password, {
      onSuccess: (result) => onConfirmed(result),
      onError: (raw) => {
        const apiError = toApiError(raw)
        // Un 401 es una sesión muerta (o revocada por el quinto fallo): el handler global ya la
        // cerró y manda al login con el motivo. Acá solo queda soltar a quien esperaba.
        if (apiError.isUnauthorized) {
          onCancel()
          return
        }
        setPassword('')
        setError(stepUpErrorMessage(apiError))
      },
    })
  }

  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title="Confirmá tu contraseña"
      description={STEP_UP_EXPLANATION}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} isLoading={confirm.isPending} disabled={!password}>
            Confirmar
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
          >
            {error}
          </p>
        )}
        <Input
          label="Contraseña"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </form>
    </Modal>
  )
}
