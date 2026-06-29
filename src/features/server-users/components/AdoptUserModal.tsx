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
}

/**
 * Adopta un usuario existente (Plan 09 §4): lo registra sin password (`has_password=false`). La
 * contraseña se podrá fijar después con el flujo normal de cambio de password.
 */
export function AdoptUserModal({ open, onClose, serverId, username, host }: AdoptUserModalProps) {
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
      { onSuccess: handleClose },
    )
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Adoptar usuario"
      description="Registra un usuario que ya existe en el motor. Nace sin contraseña; podrás fijarla después."
      size="md"
    >
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
    </Modal>
  )
}
