import { EmptyState, ErrorState, Modal, Spinner } from '@/components/ui'
import type { ServerUserOut } from '@/lib/contracts'
import { useOwnedDatabases } from '../hooks/use-server-users'

interface OwnedDatabasesModalProps {
  user: ServerUserOut | null
  onClose: () => void
}

/** Lista las bases de datos cuyo owner es el usuario (§7). */
export function OwnedDatabasesModal({ user, onClose }: OwnedDatabasesModalProps) {
  const { data, isLoading, isError, error, refetch } = useOwnedDatabases(
    user?.id ?? 0,
    user !== null,
  )

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title="Bases de datos del usuario"
      description={user ? `Propiedad de ${user.username}` : undefined}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Cargando…
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState title="Este usuario no posee bases de datos" />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {data?.map((db) => (
            <li key={db.id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium text-foreground">{db.name}</span>
              <span className="text-muted-foreground">{db.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
