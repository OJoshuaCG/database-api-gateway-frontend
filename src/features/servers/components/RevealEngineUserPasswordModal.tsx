import { useState } from 'react'
import { Button, Modal } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import { useRevealEngineUserPassword } from '../hooks/use-engine-users'

interface RevealEngineUserPasswordModalProps {
  onClose: () => void
  serverId: number
  username: string
  host?: string | null
}

const STATUS_HINT: Record<number, string> = {
  404: 'Este usuario no está en el inventario del gateway. Adóptalo o gestiónalo primero.',
  409: 'Solo se puede rotar la contraseña, no revelarla: el gateway nunca la fijó.',
}

/**
 * Secreto efímero (§ Revelar contraseña): el gateway solo puede revelar una contraseña que él
 * mismo fijó (create/rotación). Se pide de forma explícita (no se auto-revela al abrir) y no se
 * persiste fuera del estado local de este modal — al cerrarlo, desaparece.
 */
export function RevealEngineUserPasswordModal({
  onClose,
  serverId,
  username,
  host,
}: RevealEngineUserPasswordModalProps) {
  const toast = useToast()
  const reveal = useRevealEngineUserPassword(serverId)
  const [visible, setVisible] = useState(false)

  const handleCopy = async () => {
    if (!reveal.data) return
    await navigator.clipboard.writeText(reveal.data.password)
    toast.success('Contraseña copiada al portapapeles')
  }

  const apiError = reveal.isError ? toApiError(reveal.error) : null

  return (
    <Modal
      open
      onClose={onClose}
      title="Revelar contraseña"
      description={`${username}${host ? `@${host}` : ''}`}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          El motor solo guarda un hash irreversible; el gateway únicamente puede revelar una
          contraseña que él mismo fijó. La acción queda auditada.
        </p>

        {reveal.data ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
              <code className="flex-1 select-all break-all font-mono text-sm text-foreground">
                {visible ? reveal.data.password : '•'.repeat(Math.min(reveal.data.password.length, 24))}
              </code>
              <Button type="button" variant="ghost" size="sm" onClick={() => setVisible((v) => !v)}>
                {visible ? 'Ocultar' : 'Mostrar'}
              </Button>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
              Copiar al portapapeles
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => reveal.mutate({ username, host: host ?? undefined })}
            isLoading={reveal.isPending}
          >
            Revelar contraseña 🔌
          </Button>
        )}

        {apiError && (
          <p className="text-xs text-error">{STATUS_HINT[apiError.status] ?? apiError.message}</p>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
