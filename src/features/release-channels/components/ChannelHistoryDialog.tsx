import { useState } from 'react'
import { Badge, EmptyState, ErrorState, Modal, Pagination, Spinner } from '@/components/ui'
import { formatDateTime } from '@/lib/utils/format'
import { CHANNEL_EVENT_TYPES, PAGINATION } from '@/lib/contracts'
import { useBlueprintChannelHistory } from '../hooks/use-blueprint-channels'
import { channelEventTypeLabel } from '../messages'

interface ChannelHistoryDialogProps {
  modelId: number
  slug: string
  channelName: string
  onClose: () => void
}

/**
 * Bitácora del puntero de un canal, del evento más reciente al más antiguo.
 *
 * Incluye los movimientos AUTOMÁTICOS (`version_deleted`) que provoca borrar la versión apuntada:
 * sin ellos el historial no explicaría por qué el canal se movió sin que nadie lo promoviera.
 * Las versiones de cada evento son una foto de su etiqueta en ese momento; un renumerado posterior
 * no las reescribe, así que pueden no coincidir con la numeración de hoy.
 */
export function ChannelHistoryDialog({
  modelId,
  slug,
  channelName,
  onClose,
}: ChannelHistoryDialogProps) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState<number>(PAGINATION.defaultSize)
  const history = useBlueprintChannelHistory(modelId, slug, { page, size }, true)

  return (
    <Modal
      open
      onClose={onClose}
      title={`Historial del canal «${channelName}»`}
      description="Movimientos del puntero de este blueprint, del más reciente al más antiguo."
      size="lg"
    >
      <div className="flex flex-col gap-3">
        {history.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando historial…
          </div>
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : history.data && history.data.items.length > 0 ? (
          <>
            <ul className="flex flex-col gap-2">
              {history.data.items.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        event.event_type === CHANNEL_EVENT_TYPES.demote
                          ? 'warning'
                          : event.event_type === CHANNEL_EVENT_TYPES.versionDeleted
                            ? 'neutral'
                            : 'info'
                      }
                    >
                      {channelEventTypeLabel(event.event_type)}
                    </Badge>
                    <span className="flex items-center gap-1.5 text-xs">
                      <code className="rounded bg-surface-muted px-1.5 py-0.5">
                        {event.from_version ?? 'sin versión'}
                      </code>
                      <span className="text-muted-foreground">→</span>
                      <code className="rounded bg-surface-muted px-1.5 py-0.5">
                        {event.to_version ?? 'sin versión'}
                      </code>
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDateTime(event.created_at)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {event.event_type === CHANNEL_EVENT_TYPES.versionDeleted
                      ? 'Movimiento automático al borrar la versión apuntada.'
                      : `Por ${event.actor_username}.`}
                  </p>
                  {event.note && <p className="text-xs text-foreground">{event.note}</p>}
                </li>
              ))}
            </ul>
            <Pagination
              page={history.data.pagination.page}
              pages={history.data.pagination.pages}
              total={history.data.pagination.total}
              size={history.data.pagination.size}
              hasNext={history.data.pagination.has_next}
              hasPrev={history.data.pagination.has_prev}
              onPageChange={setPage}
              onSizeChange={(next) => {
                setSize(next)
                setPage(1)
              }}
              isFetching={history.isFetching}
            />
          </>
        ) : (
          <EmptyState
            title="Este canal todavía no se movió"
            description="Cuando alguien lo promueva, o se borre la versión a la que apunta, el movimiento queda acá."
          />
        )}
      </div>
    </Modal>
  )
}
