import { useState } from 'react'
import { Badge, Button, Callout, Spinner } from '@/components/ui'
import { CapabilityHint, useCapabilityGuard, useStepUp } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import { CAPABILITIES, type ManagedDatabaseOut } from '@/lib/contracts'
import {
  DATA_ACCESS_STATE_BADGE,
  DATA_CREDENTIAL_MAX_AGE_DAYS,
  DATA_CREDENTIAL_STAGE_BADGE,
  dataAccessErrorMessage,
  dataCredentialStage,
  dataViolationLabel,
} from '../data-access'
import {
  useApproveDataAccess,
  useClearDataCredential,
  useDataCredential,
  useProvisionDataCredential,
  useRequestDataAccess,
  useRevokeDataAccess,
  useVerifyDataCredential,
} from '../hooks/use-managed-databases'

interface DataAccessSectionProps {
  /** Montar solo con una BD objetivo: el estado de la credencial es por base. */
  database: ManagedDatabaseOut
}

/**
 * Lectura de FILAS de UNA base por agentes MCP (`data.read` / `data.query`), en tres pasos que el
 * servidor encadena y esta sección solo muestra:
 *
 * 1. **Credencial de datos** 🔌: una cuenta del motor con `SELECT` sobre esta base y nada más, con
 *    sonda negativa reciente. Aprovisionarla y verificarla exigen `servers.admin`.
 * 2. **Opt-in** de la base: lo pide quien tiene `data.read` en el entorno y, en production (y en
 *    bases sin entorno), lo aprueba OTRO owner: el solicitante no puede aprobar el suyo.
 * 3. **Kill switch** del gateway (`MCP_DATA_READ_ENABLED`): NO se puede ver desde acá, y nace
 *    apagado. Con él apagado todo lo anterior queda inerte; la sección lo dice en vez de prometer.
 *
 * Colapsada por defecto y con la consulta apagada hasta abrirla: es un flujo de administración,
 * no un dato que cada apertura del modal tenga que pagar. Todo botón que cambia algo pide step-up
 * (`withFresh`) y las guardas son PISTAS: decide el servidor y el 403 lo resuelve el hook.
 */
export function DataAccessSection({ database }: DataAccessSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  // El reloj se lee UNA vez (leerlo en render es impuro); el vencimiento es de granularidad de días.
  const [nowMs] = useState(() => Date.now())

  const credentialGuard = useCapabilityGuard(
    CAPABILITIES.serversAdmin,
    'gestionar la credencial de datos de esta base',
  )
  const accessGuard = useCapabilityGuard(
    CAPABILITIES.dataRead,
    'pedir, aprobar o cerrar el acceso a datos de esta base',
  )
  const stepUp = useStepUp()

  const statusQuery = useDataCredential(database.id, expanded)
  const provision = useProvisionDataCredential(database.id)
  const verify = useVerifyDataCredential(database.id)
  const clear = useClearDataCredential(database.id)
  const request = useRequestDataAccess(database.id)
  const approve = useApproveDataAccess(database.id)
  const revoke = useRevokeDataAccess(database.id)

  const busy =
    provision.isPending ||
    verify.isPending ||
    clear.isPending ||
    request.isPending ||
    approve.isPending ||
    revoke.isPending

  if (!expanded) {
    return (
      <section aria-label="Lectura de datos" className="flex flex-col gap-2">
        <Button
          variant="outline"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          className="self-start"
        >
          Configurar lectura de datos…
        </Button>
        <p className="text-xs text-muted-foreground">
          Habilita que un agente lea FILAS de esta base (no solo su estructura): credencial de
          datos, opt-in con segundo aprobador y kill switch del gateway.
        </p>
      </section>
    )
  }

  const status = statusQuery.data
  const stage = status ? dataCredentialStage(status, nowMs) : undefined
  const stageBadge = stage ? DATA_CREDENTIAL_STAGE_BADGE[stage] : undefined
  const accessBadge = status ? DATA_ACCESS_STATE_BADGE[status.data_access_state] : undefined

  const verifyError = verify.isError ? toApiError(verify.error) : null
  const violations = verifyError?.readonlyProbeViolations ?? status?.probe_violations ?? []
  const verifyMessage = verifyError ? dataAccessErrorMessage(verifyError) : undefined

  const run = (
    capability: typeof CAPABILITIES.serversAdmin | typeof CAPABILITIES.dataRead,
    action: () => void,
  ) => stepUp.withFresh(capability, action)

  return (
    <section
      aria-label="Lectura de datos"
      className="flex flex-col gap-4 rounded-md border border-border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Lectura de datos por agentes</h3>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded
          onClick={() => setExpanded(false)}
          disabled={busy}
        >
          Ocultar
        </Button>
      </div>

      <Callout tone="warning" title="Esto expone FILAS reales de la base">
        Un agente con el permiso <code className="text-xs">data.read</code> puede leer datos de
        terceros: lo que lee sale del gateway hacia el contexto de un modelo. Los permisos de la
        cuenta son fijos (<code className="text-xs">SELECT</code> sobre esta base y nada más) y cada
        lectura queda auditada.
      </Callout>

      {statusQuery.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" label="Cargando estado de la credencial de datos" />
          Cargando estado…
        </div>
      )}
      {statusQuery.isError && (
        <Callout tone="danger" title="No se pudo leer el estado de la credencial de datos">
          {toApiError(statusQuery.error).message}
        </Callout>
      )}

      {status && stage && stageBadge && accessBadge && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">1. Credencial de datos</span>
              <Badge tone={stageBadge.tone}>{stageBadge.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Cuenta del motor por base, con la contraseña cifrada (nunca se muestra). La sonda vale{' '}
              {DATA_CREDENTIAL_MAX_AGE_DAYS} días: pasado el plazo las tools la rechazan hasta
              verificarla de nuevo.
            </p>
            <div className="flex flex-wrap gap-2">
              {stage === 'missing' ? (
                <Button
                  variant="outline"
                  onClick={() => run(CAPABILITIES.serversAdmin, () => provision.mutate())}
                  isLoading={provision.isPending}
                  disabled={busy || !credentialGuard.allowed}
                  aria-describedby={credentialGuard.describedBy}
                >
                  Generar credencial de datos 🔌
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => run(CAPABILITIES.serversAdmin, () => verify.mutate())}
                    isLoading={verify.isPending}
                    disabled={busy || !credentialGuard.allowed}
                    aria-describedby={credentialGuard.describedBy}
                  >
                    {stage === 'verified' ? 'Volver a verificar 🔌' : 'Verificar credencial 🔌'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => run(CAPABILITIES.serversAdmin, () => provision.mutate())}
                    isLoading={provision.isPending}
                    disabled={busy || !credentialGuard.allowed}
                    aria-describedby={credentialGuard.describedBy}
                  >
                    Regenerar contraseña 🔌
                  </Button>
                  <Button
                    variant="danger-soft"
                    onClick={() => setConfirmClear(true)}
                    disabled={busy || confirmClear || !credentialGuard.allowed}
                    aria-describedby={credentialGuard.describedBy}
                  >
                    Revocar credencial 🔌
                  </Button>
                </>
              )}
            </div>
            <CapabilityHint guard={credentialGuard} />

            {confirmClear && (
              <Callout tone="danger" title="Revocar la credencial de datos">
                <p className="mb-2">
                  Se borra la cuenta del motor y se cierra el acceso a datos de esta base. Los
                  agentes dejan de leerla en el acto. Esta acción no se deshace: para volver a
                  abrirla hay que generar otra credencial y repetir el pedido.
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
                    Cancelar
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    isLoading={clear.isPending}
                    onClick={() =>
                      run(CAPABILITIES.serversAdmin, () =>
                        clear.mutate(undefined, { onSettled: () => setConfirmClear(false) }),
                      )
                    }
                  >
                    Confirmar revocación 🔌
                  </Button>
                </div>
              </Callout>
            )}

            {violations.length > 0 && (
              <Callout tone="danger" title="La sonda encontró permisos de más">
                {verifyMessage && <p className="mb-2">{verifyMessage}</p>}
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {violations.map((reason) => (
                    <li key={reason}>
                      {dataViolationLabel(reason)}{' '}
                      <code className="text-xs text-muted-foreground">{reason}</code>
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
            {status.probe_warnings.length > 0 && violations.length === 0 && (
              <Callout tone="info" title="Advertencias de la sonda (no bloquean)">
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {status.probe_warnings.map((warning) => (
                    <li key={warning}>
                      <code className="text-xs">{warning}</code>
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">2. Acceso a datos</span>
              <Badge tone={accessBadge.tone}>{accessBadge.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {status.data_access_second_approver_required
                ? 'En el entorno de esta base el pedido necesita la aprobación de OTRO owner: quien lo pide no puede aprobarlo.'
                : 'En el entorno de esta base el acceso se abre al pedirlo, sin segundo aprobador.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {status.data_access_state === 'closed' && (
                <Button
                  variant="outline"
                  onClick={() => run(CAPABILITIES.dataRead, () => request.mutate())}
                  isLoading={request.isPending}
                  disabled={busy || !status.has_data_credential || !accessGuard.allowed}
                  aria-describedby={accessGuard.describedBy}
                >
                  Pedir acceso a datos
                </Button>
              )}
              {status.data_access_state === 'pending' && (
                <Button
                  variant="outline"
                  onClick={() => run(CAPABILITIES.dataRead, () => approve.mutate())}
                  isLoading={approve.isPending}
                  disabled={busy || !accessGuard.allowed}
                  aria-describedby={accessGuard.describedBy}
                >
                  Aprobar acceso a datos
                </Button>
              )}
              {status.data_access_state !== 'closed' && (
                <Button
                  variant="ghost"
                  onClick={() => run(CAPABILITIES.dataRead, () => revoke.mutate())}
                  isLoading={revoke.isPending}
                  disabled={busy || !accessGuard.allowed}
                  aria-describedby={accessGuard.describedBy}
                >
                  {status.data_access_state === 'pending' ? 'Cancelar pedido' : 'Cerrar acceso'}
                </Button>
              )}
            </div>
            {!status.has_data_credential && (
              <p className="text-xs text-muted-foreground">
                Primero generá la credencial de datos: sin ella no hay nada que abrir.
              </p>
            )}
            <CapabilityHint guard={accessGuard} />
          </div>

          <Callout tone="info" title="3. Kill switch del gateway">
            Aunque la credencial esté verificada y el acceso abierto, el gateway nace con la lectura
            de datos APAGADA (<code className="text-xs">MCP_DATA_READ_ENABLED</code>): con ella
            apagada los permisos <code className="text-xs">data.read</code> de los tokens quedan
            inertes y las tools no aparecen. Esa palanca es del administrador del gateway y no se
            puede ver desde acá.
          </Callout>
        </>
      )}
    </section>
  )
}
