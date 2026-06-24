import { useState } from 'react'
import { Button, Combobox, Modal, Switch } from '@/components/ui'
import type { ManagedDatabaseOut, ServerUserOut } from '@/lib/contracts'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import { useReassignOwner } from '../hooks/use-managed-databases'

interface ReassignOwnerModalProps {
  /** Montar solo cuando hay una BD objetivo (estado fresco por apertura). */
  database: ManagedDatabaseOut
  onClose: () => void
}

/** Reasigna el propietario de una BD a otro usuario del mismo servidor (§9). */
export function ReassignOwnerModal({ database, onClose }: ReassignOwnerModalProps) {
  const [owner, setOwner] = useState<ServerUserOut | null>(null)
  const [provision, setProvision] = useState(false)
  const owners = useServerUserOptions(database.server_id)
  const reassign = useReassignOwner(database.id)

  const candidates = (owners.data ?? []).filter((user) => user.id !== database.owner_id)

  return (
    <Modal
      open
      onClose={onClose}
      title="Reasignar propietario"
      description={`Base de datos «${database.name}»`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={reassign.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              if (!owner) return
              reassign.mutate({ body: { owner_id: owner.id }, provision }, { onSuccess: onClose })
            }}
            disabled={!owner}
            isLoading={reassign.isPending}
          >
            Reasignar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Combobox<ServerUserOut>
          items={candidates}
          value={owner}
          onChange={setOwner}
          itemToString={(u) => (u.host ? `${u.username}@${u.host}` : u.username)}
          itemToKey={(u) => u.id}
          label="Nuevo propietario"
          required
          isLoading={owners.isFetching}
          placeholder="Selecciona un usuario del mismo servidor"
        />
        <Switch
          checked={provision}
          onCheckedChange={setProvision}
          label="Aplicar en el motor 🔌"
          hint="Revoca/otorga privilegios (o ALTER OWNER en PostgreSQL)."
        />
      </div>
    </Modal>
  )
}
