import { useState, type ReactNode } from 'react'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Spinner,
} from '@/components/ui'
import { CapabilityHint, useCapabilityGuard } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import { CAPABILITIES, type ChannelReference, type ChannelResolutionOut } from '@/lib/contracts'
import { derivedReferenceOf } from '../blueprint-channels'
import { useBlueprintChannels, useLiveBlueprintChannel } from '../hooks/use-blueprint-channels'
import {
  channelIgnoredReasonLabel,
  channelSourceLabel,
  releaseChannelMessage,
  releaseChannelModeLabel,
} from '../messages'
import { ChannelHistoryDialog } from './ChannelHistoryDialog'
import { PromoteChannelDialog, type PromotableVersion } from './PromoteChannelDialog'

interface BlueprintChannelsPanelProps {
  modelId: number
  /** Catálogo completo del blueprint, ordenado ascendente: lo necesita el diálogo de promoción. */
  versions: readonly PromotableVersion[]
}

/**
 * Qué versión sirve cada canal de liberación para ESTE blueprint, y desde acá se promueve.
 *
 * Tres cosas distintas que no se mezclan:
 *
 * - La **versión servida** es la que consumen las integraciones: el puntero manual, la última
 *   versión (`latest`) o el mínimo vivo del entorno (`derived`).
 * - La **referencia** (mínimo de las bases vivas del entorno enlazado) se muestra AL LADO de un
 *   canal manual, pero no lo decide: sirve para ver si el puntero va por delante o por detrás de lo
 *   que de verdad corre. Viene de la caché del inventario y se rotula así; «Leer en vivo» la
 *   recalcula conectando a cada base.
 * - **Promover** mueve el puntero. No toca ninguna base de datos.
 *
 * Un canal que no resuelve NO es un error de la pantalla: se pinta con el motivo (`code`) en lugar
 * de la versión.
 */
export function BlueprintChannelsPanel({ modelId, versions }: BlueprintChannelsPanelProps) {
  const channels = useBlueprintChannels(modelId)
  const promoteGuard = useCapabilityGuard(CAPABILITIES.blueprintsPromote, 'promover canales')
  const [promoting, setPromoting] = useState<ChannelResolutionOut | null>(null)
  const [historyOf, setHistoryOf] = useState<ChannelResolutionOut | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Canales de liberación</CardTitle>
        <CardDescription>
          Cada canal decide qué versión de este blueprint reciben las integraciones y el alta de
          bases que lo pidan. Promover mueve el puntero de un canal manual: no aplica nada ni toca
          ninguna base de datos.
        </CardDescription>
        <CapabilityHint guard={promoteGuard} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {channels.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando canales…
          </div>
        ) : channels.isError ? (
          <ErrorState
            error={channels.error}
            title="No se pudieron cargar los canales"
            onRetry={() => void channels.refetch()}
          />
        ) : channels.data && channels.data.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {channels.data.map((channel) => (
              <ChannelRow
                key={channel.channel_slug}
                modelId={modelId}
                channel={channel}
                canPromote={promoteGuard.allowed}
                promoteDescribedBy={promoteGuard.describedBy}
                onPromote={() => setPromoting(channel)}
                onHistory={() => setHistoryOf(channel)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Todavía no hay canales de liberación"
            description="Un security_officer los crea desde Administración → Canales de liberación."
          />
        )}
      </CardContent>

      {promoting && (
        <PromoteChannelDialog
          key={promoting.channel_slug}
          modelId={modelId}
          channel={promoting}
          versions={versions}
          onClose={() => setPromoting(null)}
        />
      )}
      {historyOf && (
        <ChannelHistoryDialog
          key={historyOf.channel_slug}
          modelId={modelId}
          slug={historyOf.channel_slug}
          channelName={historyOf.channel_name}
          onClose={() => setHistoryOf(null)}
        />
      )}
    </Card>
  )
}

interface ChannelRowProps {
  modelId: number
  channel: ChannelResolutionOut
  canPromote: boolean
  promoteDescribedBy: string | undefined
  onPromote: () => void
  onHistory: () => void
}

function ChannelRow({
  modelId,
  channel,
  canPromote,
  promoteDescribedBy,
  onPromote,
  onHistory,
}: ChannelRowProps) {
  // La lectura en vivo abre una conexión por base y tiene rate limit: solo corre al pedirla.
  const [liveRequested, setLiveRequested] = useState(false)
  const hasEnvironment = channel.environment_slug != null
  const live = useLiveBlueprintChannel(modelId, channel.channel_slug, liveRequested)

  const isManual = channel.resolution_mode === 'manual'
  const reference = derivedReferenceOf(live.data ?? channel)
  const requestLive = () => {
    if (liveRequested) void live.refetch()
    else setLiveRequested(true)
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{channel.channel_name}</span>
        <code className="text-xs text-muted-foreground">{channel.channel_slug}</code>
        <Badge tone="info">{releaseChannelModeLabel(channel.resolution_mode)}</Badge>
        {hasEnvironment && <Badge tone="neutral">{channel.environment_slug}</Badge>}

        <div className="ml-auto flex flex-wrap gap-2">
          {isManual && (
            <Button
              size="sm"
              disabled={!canPromote}
              aria-describedby={promoteDescribedBy}
              onClick={onPromote}
            >
              Promover…
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onHistory}>
            Historial
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Sirve:</span>
        <ResolvedVersion
          resolved={channel.resolved}
          version={channel.version}
          source={channel.source}
          fallback={<strong className="text-foreground">sin versión</strong>}
        />
      </div>

      {!channel.resolved && (
        <p className="text-xs text-warning">
          {releaseChannelMessage(channel.code) ?? 'El canal no pudo resolverse.'}
        </p>
      )}

      {hasEnvironment && (
        <div className="flex flex-col gap-2 rounded-lg bg-surface-muted/50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {isManual ? 'Referencia (no decide el canal):' : 'Mínimo en el entorno:'}
            </span>
            {reference === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <ResolvedVersion
                resolved={reference.resolved}
                version={reference.version}
                source={reference.source}
                fallback={
                  <span className="text-xs text-warning">
                    {releaseChannelMessage(reference.code) ?? 'No se pudo calcular.'}
                  </span>
                }
              />
            )}
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              isLoading={live.isFetching}
              onClick={requestLive}
            >
              Leer en vivo 🔌
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {isManual
              ? 'La menor versión que tienen hoy las bases del entorno enlazado, para comparar con el puntero.'
              : 'La menor versión que tienen hoy las bases del entorno enlazado.'}{' '}
            «Leer en vivo» conecta a cada base: es más lento y tiene límite de uso.
          </p>
          {live.isError && (
            <Callout tone="danger" title="No se pudo leer en vivo">
              <p>{toApiError(live.error).message}</p>
            </Callout>
          )}
          {reference && reference.databases.length > 0 && (
            <ReferenceDatabases databases={reference.databases} />
          )}
        </div>
      )}
    </li>
  )
}

interface ResolvedVersionProps {
  resolved: boolean
  version: string | null | undefined
  source: string | null | undefined
  /** Lo que se pinta sin versión: cada bloque explica la ausencia a su manera. */
  fallback: ReactNode
}

/** Versión resuelta (o su `fallback`) más el badge de dónde sale. */
function ResolvedVersion({ resolved, version, source, fallback }: ResolvedVersionProps) {
  const sourceLabel = channelSourceLabel(source)
  return (
    <>
      {resolved && version ? (
        <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{version}</code>
      ) : (
        fallback
      )}
      {sourceLabel && <Badge tone="neutral">{sourceLabel}</Badge>}
    </>
  )
}

/**
 * Bases del cálculo. Las que no cuentan dicen por qué (cuarentena, sin migrar…) y las que cuentan
 * pero no se pudieron leer se marcan: son las que vuelven «no resuelto» a un canal derivado.
 */
function ReferenceDatabases({ databases }: { databases: ChannelReference['databases'] }) {
  return (
    <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
      {databases.map((database) => {
        const ignoredLabel = channelIgnoredReasonLabel(database.ignored_reason)
        return (
          <li
            key={database.managed_database_id}
            className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1"
          >
            <span className="font-medium text-foreground">{database.database_name}</span>
            <code className="rounded bg-surface-muted px-1.5 py-0.5">
              {database.current_version ?? '—'}
            </code>
            {!database.readable && <Badge tone="error">no se pudo leer</Badge>}
            {!database.counted && (
              <Badge tone="neutral">
                {ignoredLabel ? `no cuenta: ${ignoredLabel}` : 'no cuenta'}
              </Badge>
            )}
          </li>
        )
      })}
    </ul>
  )
}
