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
 * de solo lectura, y cargarla, verificarla o quitarla.
 *
 * Las tres acciones son `servers.admin` + step-up. La guarda es una pista: si el acceso cambió, el
 * 403 lo resuelve `notifyMutationError`, y el step-up lo pide `runRequest` al primer 403.
 */
export function ReadonlyCredentialPanel({ server }: ReadonlyCredentialPanelProps) {
  // El reloj se lee UNA vez, en el inicializador: leerlo en render sería impuro y el vencimiento
  // tiene granularidad de días, así que no hace falta un tick.
  const [nowMs] = useState(() => Date.now())
  const [formOpen, setFormOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const guard = useCapabilityGuard(
    CAPABILITIES.serversAdmin,
    'administrar la credencial de solo lectura del MCP',
  )
  const verify = useTestReadonlyConnection(server.id)
  const clear = useClearReadonlyCredential(server.id)

  const state = readonlyCredentialState(server, nowMs)
  const badge = STATE_BADGE[state]
  const hasCredential = state !== 'missing'
  const verifiedAt = server.readonly_verified_at ?? null

  const probeError = verify.error ? toApiError(verify.error) : null
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
              grants y volvé a verificar:
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
        }}
        serverId={server.id}
        replacing={hasCredential}
      />

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
