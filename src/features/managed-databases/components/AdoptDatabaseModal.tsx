import { useState } from 'react'
import { Button, Combobox, Input, Modal, Textarea } from '@/components/ui'
import type { DatabaseModelOut, ServerUserOut } from '@/lib/contracts'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import { useDatabaseModelOptions } from '@/features/database-models/hooks/use-database-model-options'
import { useAdoptDatabase } from '../hooks/use-adopt-database'

interface AdoptDatabaseModalProps {
  open: boolean
  onClose: () => void
  serverId: number
  /** Nombre EXACTO de la BD existente (precargado desde la fila de reconciliación). */
  databaseName: string
}

/**
 * Adopta una BD existente (Plan 09 §3): la registra en el inventario sin recrearla. Exige un
 * propietario (ServerUser del mismo servidor) y, opcionalmente, vincula un blueprint.
 */
export function AdoptDatabaseModal({
  open,
  onClose,
  serverId,
  databaseName,
}: AdoptDatabaseModalProps) {
  const owners = useServerUserOptions(serverId)
  const models = useDatabaseModelOptions()
  const adopt = useAdoptDatabase()

  const [owner, setOwner] = useState<ServerUserOut | null>(null)
  const [model, setModel] = useState<DatabaseModelOut | null>(null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleClose = () => {
    setOwner(null)
    setModel(null)
    setNotes('')
    setError(null)
    onClose()
  }

  const submit = () => {
    if (!owner) {
      setError('Selecciona un propietario.')
      return
    }
    setError(null)
    adopt.mutate(
      {
        name: databaseName,
        server_id: serverId,
        owner_id: owner.id,
        model_id: model?.id ?? null,
        notes: notes.trim() || null,
      },
      { onSuccess: handleClose },
    )
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Adoptar base de datos"
      description="Registra una BD que ya existe en el motor, sin recrearla ni tocar sus datos."
      size="md"
    >
      <div className="flex flex-col gap-4">
        <Input label="Nombre" value={databaseName} readOnly />
        <Combobox<ServerUserOut>
          items={owners.data ?? []}
          value={owner}
          onChange={setOwner}
          itemToString={(u) => (u.host ? `${u.username}@${u.host}` : u.username)}
          itemToKey={(u) => u.id}
          label="Propietario"
          placeholder="Elige un ServerUser de este servidor"
          isLoading={owners.isLoading}
          error={error ?? undefined}
          required
        />
        <p className="text-xs text-muted-foreground">
          ¿No aparece el propietario? Adóptalo primero desde la pestaña Usuarios.
        </p>
        <Combobox<DatabaseModelOut>
          items={models.data ?? []}
          value={model}
          onChange={setModel}
          itemToString={(m) => m.name}
          itemToKey={(m) => m.id}
          label="Blueprint (opcional)"
          placeholder="Ninguno"
          isLoading={models.isLoading}
          clearable
        />
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
            Adoptar 🔌
          </Button>
        </div>
      </div>
    </Modal>
  )
}
