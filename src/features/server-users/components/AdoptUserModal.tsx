import { useState } from 'react'
import { Button, Input, Modal, Textarea } from '@/components/ui'
import { useAdoptUser } from '../hooks/use-adopt-user'

interface AdoptUserModalProps {
  open: boolean
  onClose: () => void
  serverId: number
  /** username/host precargados desde la fila de reconciliación. */
  username: string
  host?: string | null
  /**
   * CTA post-adopción: si se provee, al adoptar el modal NO se cierra — ofrece encadenar con
   * «Definir contraseña conocida» (guarda la contraseña vigente cifrada, sin tocar el motor).
   */
  onDefinePassword?: () => void
}

/**
 * Adopta un usuario existente (Plan 09 §4): lo registra sin password (`has_password=false`). La
 * contraseña se puede fijar después sin tocar el motor con «Definir contraseña conocida»
 * (`define-password`, §7.4) o cambiar de verdad con la rotación normal.
 */
export function AdoptUserModal({
  open,
  onClose,
  serverId,
  username,
  host,
  onDefinePassword,
}: AdoptUserModalProps) {
  const adopt = useAdoptUser()
  const [notes, setNotes] = useState('')

  const handleClose = () => {
    setNotes('')
    onClose()
  }

  const submit = () => {
    adopt.mutate(
      {
        server_id: serverId,
        username,
        host: host ?? undefined,
        notes: notes.trim() || null,
      },
      // Con CTA disponible, el modal queda abierto mostrando el siguiente paso sugerido.
      { onSuccess: onDefinePassword ? undefined : handleClose },
    )
  }

  const showNextStep = adopt.isSuccess && Boolean(onDefinePassword)

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Adoptar usuario"
      description="Registra un usuario que ya existe en el motor. Nace sin contraseña; podrás guardarla después con «Definir contraseña conocida», sin tocar el motor."
      size="md"
    >
      {showNextStep ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-foreground">
            Usuario adoptado. El gateway aún no conoce su contraseña (no podrá revelarla).
          </p>
          <p className="text-xs text-muted-foreground">
            Si conoces la contraseña vigente, puedes dictársela al gateway ahora: se guarda cifrada
            sin ejecutar nada en el motor.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={handleClose}>
              Cerrar
            </Button>
            <Button onClick={onDefinePassword}>Definir contraseña conocida</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Input label="Usuario" value={username} readOnly />
          {host != null && <Input label="Host" value={host} readOnly hint="Solo MySQL/MariaDB." />}
          <Textarea
            label="Notas (opcional)"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={handleClose} disabled={adopt.isPending}>
              Cancelar
            </Button>
            <Button onClick={submit} isLoading={adopt.isPending}>
              Adoptar usuario 🔌
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
