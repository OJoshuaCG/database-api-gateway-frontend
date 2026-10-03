import { useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  type BadgeTone,
} from '@/components/ui'
import { CapabilityHint, useCapabilityGuard } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import { CAPABILITIES, type ServerOut } from '@/lib/contracts'
import { formatUtcDateTime } from '@/lib/utils'
import {
  READONLY_MAX_AGE_DAYS,
  READONLY_PROBE_FAILED,
  readonlyCredentialState,
  readonlyViolationLabel,
  type ReadonlyCredentialState,
} from '../readonly-credential'
import {
  useClearReadonlyCredential,
  useProvisionReadonlyCredential,
  useTestReadonlyConnection,
} from '../hooks/use-server-mutations'
import { ReadonlyCredentialModal } from './ReadonlyCredentialModal'

const STATE_BADGE: Record<ReadonlyCredentialState, { tone: BadgeTone; label: string }> = {
  missing: { tone: 'neutral', label: 'Sin credencial' },
  unverified: { tone: 'warning', label: 'Sin verificar' },
  stale: { tone: 'warning', label: 'Verificación vencida' },
  verified: { tone: 'success', label: 'Verificada' },
}

/** Qué significa cada estado para el MCP, en una frase. */
function stateExplanation(state: ReadonlyCredentialState, verifiedAt: string | null): string {
  switch (state) {
    case 'missing':
      return 'El servidor MCP no puede leer este servidor: las tools que leen el motor responden «mcp.readonly_credential_missing».'
    case 'unverified':
      return 'Hay credencial, pero la sonda todavía no la verificó. Hasta que pase, el MCP no la usa.'
    case 'stale':
      return `Se verificó el ${formatUtcDateTime(verifiedAt)}, hace más de ${READONLY_MAX_AGE_DAYS} días. El MCP la rechaza hasta volver a verificarla.`
    case 'verified':
      return `Verificada el ${formatUtcDateTime(verifiedAt)}. El MCP la usa para leer el catálogo; vence a los ${READONLY_MAX_AGE_DAYS} días.`
  }
}

interface ReadonlyCredentialPanelProps {
  server: ServerOut
}

/**
 * «Acceso de agentes (MCP)» en el detalle del servidor (api-reference-v30): estado de la credencial
 * de solo lectura, y generarla automáticamente (v32), cargarla a mano, verificarla o quitarla.
 *
 * Las acciones son `servers.admin` + step-up. La guarda es una pista: si el acceso cambió, el
 * 403 lo resuelve `notifyMutationError`, y el step-up lo pide `runRequest` al primer 403.
 */
export function ReadonlyCredentialPanel({ server }: ReadonlyCredentialPanelProps) {
  // El reloj se lee UNA vez, en el inicializador: leerlo en render sería impuro y el vencimiento
  // tiene granularidad de días, así que no hace falta un tick.
  const [nowMs] = useState(() => Date.now())
  const [formOpen, setFormOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmProvision, setConfirmProvision] = useState(false)

  const guard = useCapabilityGuard(
    CAPABILITIES.serversAdmin,
    'administrar la credencial de solo lectura del MCP',
  )
  const verify = useTestReadonlyConnection(server.id)
  const clear = useClearReadonlyCredential(server.id)
  const provision = useProvisionReadonlyCredential(server.id)

  const state = readonlyCredentialState(server, nowMs)
  const badge = STATE_BADGE[state]
  const hasCredential = state !== 'missing'
  const verifiedAt = server.readonly_verified_at ?? null

  // La sonda corre en «Verificar» y también dentro del aprovisionamiento: los dos 422 se muestran
  // en el mismo Callout. Gana el más reciente que haya fallado.
  const failedMutationError = provision.error ?? verify.error
  const probeError = failedMutationError ? toApiError(failedMutationError) : null
  const violations =
    probeError?.code === READONLY_PROBE_FAILED ? (probeError.readonlyProbeViolations ?? []) : []

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Acceso de agentes (MCP)</CardTitle>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
        <CardDescription>
          Credencial de solo lectura con la que el servidor MCP lee el catálogo de este motor. Ni el
          usuario ni la contraseña se vuelven a mostrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-foreground">{stateExplanation(state, verifiedAt)}</p>

        {probeError?.code === READONLY_PROBE_FAILED && (
          <Callout tone="danger" title="La credencial no es de solo lectura">
            <p className="mb-2">
              El motor le permite escribir o tiene permisos de más. Pedile al DBA que quite estos
              grants y volvé a verificar, o generá la credencial de nuevo:
            </p>
            {violations.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {violations.map((reason) => (
                  <li key={reason}>
                    {readonlyViolationLabel(reason)}{' '}
                    <code className="text-xs text-muted-foreground">{reason}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{probeError.message}</p>
            )}
          </Callout>
        )}

        <div className="flex flex-wrap gap-2">
          {/* Primaria mientras el MCP no puede leer; si ya está verificada, regenerar rota la
              contraseña y no es lo que se quiere por defecto. */}
          <Button
            variant={state === 'verified' ? 'outline' : 'primary'}
            onClick={() => setConfirmProvision(true)}
            disabled={!guard.allowed}
            aria-describedby={guard.describedBy}
          >
            {hasCredential ? 'Regenerar credencial 🔌' : 'Generar credencial automáticamente 🔌'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setFormOpen(true)}
            disabled={!guard.allowed}
            aria-describedby={guard.describedBy}
          >
            {hasCredential ? 'Reemplazar credencial' : 'Cargar credencial'}
          </Button>
          {hasCredential && (
            <>
              <Button
                variant="outline"
                onClick={() => verify.mutate()}
                isLoading={verify.isPending}
                disabled={!guard.allowed}
                aria-describedby={guard.describedBy}
              >
                Verificar 🔌
              </Button>
              {/* `danger-soft`: esto solo abre la confirmación, donde va el rojo pleno. */}
              <Button
                variant="danger-soft"
                onClick={() => setConfirmClear(true)}
                disabled={!guard.allowed}
                aria-describedby={guard.describedBy}
              >
                Quitar
              </Button>
            </>
          )}
        </div>
        <CapabilityHint guard={guard} />
      </CardContent>

      <ReadonlyCredentialModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          // Una credencial nueva invalida el resultado de la sonda anterior.
          verify.reset()
          provision.reset()
        }}
        serverId={server.id}
        replacing={hasCredential}
      />

      <ConfirmDialog
        open={confirmProvision}
        onClose={() => setConfirmProvision(false)}
        onConfirm={() => {
          verify.reset()
          // Se cierra al terminar, bien o mal: el resultado (toast o Callout) queda en el panel.
          provision.mutate(undefined, { onSettled: () => setConfirmProvision(false) })
        }}
        title={
          hasCredential
            ? 'Regenerar la credencial de solo lectura'
            : 'Generar la credencial de solo lectura'
        }
        description={`Se opera sobre el motor de «${server.name}» (${server.host}:${server.port}).`}
        confirmLabel={hasCredential ? 'Regenerar 🔌' : 'Generar 🔌'}
        tone="primary"
        isLoading={provision.isPending}
        confirmDisabled={!guard.allowed}
      >
        <Callout tone="warning" title="La credencial es por servidor, no por base de datos">
          <p>
            Alcanza TODAS las bases no internas de este servidor, no solo una. Las bases que se
            creen después no quedan cubiertas hasta que la regeneres.
          </p>
        </Callout>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground">
          <li>
            El gateway usa la cuenta de administrador del servidor para crear
            {hasCredential ? ' o rotar' : ''} la cuenta de solo lectura en el motor.
          </li>
          <li>
            El nombre y el host de la cuenta salen de la configuración del gateway; no se eligen
            acá.
          </li>
          <li>
            La contraseña se genera y se guarda cifrada: nunca se muestra.
            {hasCredential
              ? ' Regenerar invalida la contraseña anterior.'
              : ' Si la cuenta ya existía, se le rota la contraseña.'}
          </li>
          <li>
            Los permisos son fijos y de solo lectura: SELECT, SHOW VIEW, TRIGGER y EVENT, más la
            visibilidad de rutinas donde el motor lo soporta.
          </li>
          <li>Al terminar, el gateway verifica que la cuenta no pueda escribir.</li>
        </ul>
        <p className="text-sm text-muted-foreground">
          Para elegir vos la cuenta, cerrá este aviso y usá «
          {hasCredential ? 'Reemplazar credencial' : 'Cargar credencial'}».
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() =>
          clear.mutate(undefined, {
            onSuccess: () => {
              setConfirmClear(false)
              verify.reset()
            },
          })
        }
        title="Quitar la credencial de solo lectura"
        description={`El servidor MCP dejará de poder leer «${server.name}» hasta que se cargue y verifique otra.`}
        confirmLabel="Quitar"
        isLoading={clear.isPending}
        confirmDisabled={!guard.allowed}
      />
    </Card>
  )
}
