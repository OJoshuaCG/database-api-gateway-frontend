import { useState } from 'react'
import { Button, Callout, Modal, Switch } from '@/components/ui'
import { CapabilityHint, useCapabilityGuard, useStepUp } from '@/features/auth'
import { CAPABILITIES, type ManagedDatabaseOut } from '@/lib/contracts'
import { useSetAgentAccess } from '../hooks/use-managed-databases'

interface AgentAccessModalProps {
  /** Montar solo cuando hay una BD objetivo (estado fresco por apertura). */
  database: ManagedDatabaseOut
  onClose: () => void
}

/**
 * Opt-in y bloqueo de emergencia de UNA base frente a los agentes MCP.
 *
 * Habilitar el entorno no abre ninguna base: este es el permiso por base, y es una de las
 * condiciones del gate (además: entorno abierto, credencial de solo lectura del servidor y token
 * de agente con alcance). Por eso el copy lo dice explícito.
 *
 * El bloqueo gana sobre el permiso y no tiene override. Se deja el permiso editable aun con el
 * bloqueo encendido (no se lo apaga solo) para que quitar el bloqueo devuelva la base al estado
 * que el operador había decidido, y se avisa que mientras tanto no tiene efecto.
 *
 * `environments.write` es global (capa 1) y pide step-up: la guarda es una pista y el 403 lo
 * resuelve `notifyMutationError`.
 */
export function AgentAccessModal({ database, onClose }: AgentAccessModalProps) {
  const [allowed, setAllowed] = useState(database.agent_access_allowed)
  const [blocked, setBlocked] = useState(database.agent_access_blocked)
  const guard = useCapabilityGuard(
    CAPABILITIES.environmentsWrite,
    'cambiar el acceso de agentes de esta base',
  )
  const setAccess = useSetAgentAccess(database.id)
  const stepUp = useStepUp()

  const unchanged =
    allowed === database.agent_access_allowed && blocked === database.agent_access_blocked

  const submit = () => {
    setAccess.mutate({ allowed, blocked }, { onSuccess: onClose })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Acceso de agentes"
      description={`Base de datos «${database.name}»`}
      footer={
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={setAccess.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={() => stepUp.withFresh(CAPABILITIES.environmentsWrite, submit)}
              disabled={unchanged || !guard.allowed}
              aria-describedby={guard.describedBy}
              isLoading={setAccess.isPending}
            >
              Guardar
            </Button>
          </div>
          <CapabilityHint guard={guard} />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Define si un agente MCP puede leer esta base. Es un permiso por base: abrir el entorno no
          abre ninguna, y esta tampoco es alcanzable si su entorno sigue cerrado.
        </p>
        <Switch
          checked={allowed}
          onCheckedChange={setAllowed}
          disabled={!guard.allowed}
          label="Permitir agentes"
          hint="Opt-in de esta base. Los agentes solo podrán leerla, nunca modificarla."
        />
        <Switch
          checked={blocked}
          onCheckedChange={setBlocked}
          disabled={!guard.allowed}
          label="Bloqueo de emergencia"
          hint="Gana sobre «Permitir agentes» y no tiene excepciones: corta el acceso aunque todo lo demás esté abierto."
        />
        {blocked && allowed && (
          <Callout tone="warning" title="El bloqueo anula el permiso">
            Mientras el bloqueo esté encendido, «Permitir agentes» no tiene efecto.
          </Callout>
        )}
      </div>
    </Modal>
  )
}
