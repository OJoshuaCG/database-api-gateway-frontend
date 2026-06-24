import { EmptyState, ErrorState, Modal, Spinner } from '@/components/ui'
import type { DatabaseModelOut } from '@/lib/contracts'
import { useModelDatabases } from '../hooks/use-database-models'

interface ModelDatabasesModalProps {
  model: DatabaseModelOut | null
  onClose: () => void
}

/** BDs que replican el blueprint (§8). */
export function ModelDatabasesModal({ model, onClose }: ModelDatabasesModalProps) {
  const { data, isLoading, isError, error, refetch } = useModelDatabases(
    model?.id ?? 0,
    model !== null,
  )

  return (
    <Modal
      open={model !== null}
      onClose={onClose}
      title="Bases de datos del blueprint"
      description={model ? `Replican «${model.name}»` : undefined}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Cargando…
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState title="Ninguna base de datos replica este blueprint" />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {data?.map((db) => (
            <li key={db.id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium text-foreground">{db.name}</span>
              <span className="text-muted-foreground">
                {db.model_version ?? '—'} · {db.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
