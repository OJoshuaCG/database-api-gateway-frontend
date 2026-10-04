import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Callout, Checkbox, Modal, Switch } from '@/components/ui'
import { CapabilityHint, useCapabilityGuard, useStepUp } from '@/features/auth'
import { useProvisionReadonlyCredential } from '@/features/servers/hooks/use-server-mutations'
import { useServer } from '@/features/servers/hooks/use-servers'
import {
  READONLY_PROBE_FAILED,
  readonlyCredentialErrorMessage,
  readonlyCredentialState,
  readonlyViolationLabel,
} from '@/features/servers/readonly-credential'
import { toApiError, type ApiError } from '@/lib/api/errors'
import { CAPABILITIES, type ManagedDatabaseOut } from '@/lib/contracts'
import { serverPath } from '@/lib/routes'
import { useSetAgentAccess } from '../hooks/use-managed-databases'
import { DataAccessSection } from './DataAccessSection'

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
 * La LECTURA DE FILAS (`data.read`) es otro permiso, con su propia credencial por base y su propio
 * opt-in con segundo aprobador: vive en `DataAccessSection`, colapsada, y no se mezcla con este
 * guardado (cambiar «Permitir agentes» no abre datos).
 *
 * `environments.write` es global (capa 1) y pide step-up: la guarda es una pista y el 403 lo
 * resuelve `notifyMutationError`.
 *
 * UN SOLO PASO: permitir una base no alcanza si el SERVIDOR no tiene credencial de solo lectura
 * verificada (el MCP la lista pero no puede leer su estructura). Al habilitar, si falta, el modal
 * ofrece generarla en la misma acción, con consentimiento explícito y a la vista (nunca en
 * silencio): es una operación 🔌 sobre el motor que alcanza a TODAS las bases del servidor. El
 * orden es fijo —primero el permiso, después la credencial— y sin reintentos: si la segunda parte
 * falla, el permiso queda concedido (no se revierte) y se avisa con el motivo.
 */
export function AgentAccessModal({ database, onClose }: AgentAccessModalProps) {
  const [allowed, setAllowed] = useState(database.agent_access_allowed)
  const [blocked, setBlocked] = useState(database.agent_access_blocked)
  const guard = useCapabilityGuard(
    CAPABILITIES.environmentsWrite,
    'cambiar el acceso de agentes de esta base',
  )
  const credentialGuard = useCapabilityGuard(
    CAPABILITIES.serversAdmin,
    'generar la credencial de solo lectura del servidor',
  )
  const setAccess = useSetAgentAccess(database.id)
  const provision = useProvisionReadonlyCredential(database.server_id)
  const stepUp = useStepUp()

  // El reloj se lee UNA vez (leerlo en render es impuro); el vencimiento es de granularidad de días.
  const [nowMs] = useState(() => Date.now())
  // Solo al habilitar: al cerrar el acceso no hay nada que ofrecer, así que ni se consulta.
  const serverQuery = useServer(database.server_id, allowed)
  const credentialState = serverQuery.data
    ? readonlyCredentialState(serverQuery.data, nowMs)
    : undefined
  const credentialMissing =
    allowed && credentialState !== undefined && credentialState !== 'verified'
  const canOfferProvision = credentialMissing && credentialGuard.allowed
  // `null` = el operador no tocó la casilla: rige el default (marcada, que es el objetivo).
  const [provisionChoice, setProvisionChoice] = useState<boolean | null>(null)
  const alsoProvision = canOfferProvision && (provisionChoice ?? true)
  // El permiso ya quedó guardado pero la credencial falló: el modal sigue abierto para explicarlo.
  const [provisionError, setProvisionError] = useState<ApiError | null>(null)

  const unchanged =
    allowed === database.agent_access_allowed && blocked === database.agent_access_blocked

  const submit = () => {
    setProvisionError(null)
    setAccess.mutate(
      { allowed, blocked },
      {
        onSuccess: () => {
          if (!alsoProvision) {
            onClose()
            return
          }
          // Solo se llega acá si el permiso se guardó. Sin reintento: un 422/409/429 se explica.
          provision.mutate(undefined, {
            onSuccess: onClose,
            onError: (error) => setProvisionError(toApiError(error)),
          })
        },
      },
    )
  }

  const busy = setAccess.isPending || provision.isPending
  const violations =
    provisionError?.code === READONLY_PROBE_FAILED
      ? (provisionError.readonlyProbeViolations ?? [])
      : []

  return (
    <Modal
      open
      onClose={onClose}
      title="Acceso de agentes"
      description={`Base de datos «${database.name}»`}
      footer={
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {provisionError ? 'Cerrar' : 'Cancelar'}
            </Button>
            <Button
              onClick={() => stepUp.withFresh(CAPABILITIES.environmentsWrite, submit)}
              // Con el permiso ya guardado no se reenvía: reintentar la credencial es desde el
              // panel del servidor, a propósito (sin reintentos automáticos ni disfrazados).
              disabled={unchanged || !guard.allowed || provisionError !== null}
              aria-describedby={guard.describedBy}
              isLoading={busy}
            >
              {alsoProvision ? 'Permitir y generar credencial 🔌' : 'Guardar'}
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
          hint="Opt-in de esta base. Los agentes leen su estructura y nunca la modifican; la lectura de filas se configura aparte, más abajo."
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

        {canOfferProvision && (
          <section
            aria-label="Credencial de solo lectura del servidor"
            className="flex flex-col gap-3 rounded-md border border-warning/30 bg-warning/10 p-3"
          >
            <Checkbox
              checked={alsoProvision}
              onChange={(event) => setProvisionChoice(event.target.checked)}
              disabled={busy || provisionError !== null}
              label="Generar también la credencial de solo lectura del servidor 🔌"
              hint="El servidor todavía no tiene una credencial de solo lectura verificada."
            />
            <p className="text-sm text-foreground">
              El MCP podrá listar esta base, pero no leer sus tablas ni columnas hasta que el
              servidor tenga una credencial de solo lectura verificada.
            </p>
            <p className="text-sm font-medium text-foreground">
              La credencial es por servidor, no por base de datos: alcanza TODAS las bases no
              internas de este servidor, no solo esta. Las bases que se creen después no quedan
              cubiertas hasta que la regeneres.
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground">
              <li>
                El gateway usa la cuenta de administrador del servidor para crear o rotar la cuenta
                de solo lectura en el motor.
              </li>
              <li>La contraseña se genera y se guarda cifrada: nunca se muestra.</li>
              <li>
                Los permisos son fijos y de solo lectura. Al terminar, el gateway verifica que la
                cuenta no pueda escribir.
              </li>
            </ul>
          </section>
        )}
        {credentialMissing && !credentialGuard.allowed && (
          <Callout tone="info" title="Falta la credencial de solo lectura del servidor">
            <p>
              El MCP podrá listar esta base, pero no leer su estructura hasta que el servidor tenga
              una credencial de solo lectura verificada. Un administrador con el permiso{' '}
              <code className="text-xs">servers.admin</code> tiene que generarla en el{' '}
              <Link
                to={serverPath(database.server_id)}
                className="font-medium text-primary hover:underline"
              >
                panel del servidor
              </Link>
              .
            </p>
          </Callout>
        )}

        {provisionError && (
          <Callout tone="danger" title="El acceso se concedió, pero la credencial no se generó">
            <p className="mb-2">
              Los agentes ya tienen permiso sobre esta base, pero el MCP no podrá leer su estructura
              hasta que el servidor tenga la credencial de solo lectura.
            </p>
            {violations.length > 0 ? (
              <ul className="mb-2 flex list-disc flex-col gap-1 pl-5">
                {violations.map((reason) => (
                  <li key={reason}>
                    {readonlyViolationLabel(reason)}{' '}
                    <code className="text-xs text-muted-foreground">{reason}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-2">
                {readonlyCredentialErrorMessage(provisionError) ?? provisionError.message}
              </p>
            )}
            <p>
              Podés reintentarlo desde el{' '}
              <Link
                to={serverPath(database.server_id)}
                className="font-medium text-primary hover:underline"
              >
                panel del servidor
              </Link>
              .
            </p>
          </Callout>
        )}

        <DataAccessSection database={database} />
      </div>
    </Modal>
  )
}
