import { useState } from 'react'
import { Button, Combobox, Modal, Switch } from '@/components/ui'
import { CapabilityHint, useCapabilityGuard } from '@/features/auth'
import {
  CAPABILITIES,
  CAPABILITY_ESCALATIONS,
  type ManagedDatabaseOut,
  type ServerUserOut,
} from '@/lib/contracts'
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

  /*
   * Las dos variantes tienen capa 2 EN esta base (`require_at` + `assert_at`), así que las dos
   * guardas llevan el destino. Solo inventario pide `databases.write`; `provision=true` SUBE a
   * `databases.drop` (v23 §4): en PostgreSQL el dueño de una base puede hacerle `DROP DATABASE`
   * y en MySQL/MariaDB el re-GRANT le da `ALL PRIVILEGES`, así que entregarla equivale a poder
   * borrarla. Además exige `engine_users.grant_admin` (v41): es delegar privilegios.
   * Sin ellas el switch queda apagado y deshabilitado con el motivo a la vista: el
   * cambio de inventario sigue disponible.
   */
  const target = { serverId: database.server_id, environmentId: database.environment_id ?? null }
  const writeGuard = useCapabilityGuard(
    CAPABILITIES.databasesWrite,
    'reasignar el propietario de esta base',
    { scope: target },
  )
  const provisionGuard = useCapabilityGuard(
    [CAPABILITIES.databasesWrite, ...CAPABILITY_ESCALATIONS.reassignOwnerProvision],
    'aplicar el cambio de propietario en el motor',
    { scope: target },
  )
  const activeGuard = provision ? provisionGuard : writeGuard

  const candidates = (owners.data ?? []).filter((user) => user.id !== database.owner_id)

  return (
    <Modal
      open
      onClose={onClose}
      title="Reasignar propietario"
      description={`Base de datos «${database.name}»`}
      footer={
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={reassign.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!owner) return
                reassign.mutate({ body: { owner_id: owner.id }, provision }, { onSuccess: onClose })
              }}
              disabled={!owner || !activeGuard.allowed}
              aria-describedby={activeGuard.describedBy}
              isLoading={reassign.isPending}
            >
              Reasignar
            </Button>
          </div>
          {/* El motivo del `provision` va en el hint del switch; acá, solo el de reasignar. */}
          {!provision && <CapabilityHint guard={writeGuard} />}
        </div>
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
          placeholder="Seleccioná un usuario del mismo servidor"
        />
        <Switch
          checked={provision}
          onCheckedChange={setProvision}
          // Deshabilitado solo para ENCENDERLO: si quedara encendido con el acceso recién
          // perdido, apagarlo tiene que seguir siendo posible.
          disabled={!provision && !provisionGuard.allowed}
          label="Aplicar en el motor 🔌"
          hint={provisionGuard.hint ?? 'Revoca/otorga privilegios (o ALTER OWNER en PostgreSQL).'}
        />
      </div>
    </Modal>
  )
}
