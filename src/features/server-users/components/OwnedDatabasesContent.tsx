import { Link } from 'react-router-dom'
import { EmptyState, ErrorState, Spinner } from '@/components/ui'
import { serverDatabasePath } from '@/lib/routes'
import { ProvisionStatusBadge } from '@/features/managed-databases/components/ProvisionStatusBadge'
import { useOwnedDatabases } from '../hooks/use-server-users'

interface OwnedDatabasesContentProps {
  userId: number
  enabled?: boolean
}

/**
 * Lista las bases de datos cuyo owner es el usuario (§7). Contenido embebible: se extrajo de
 * `OwnedDatabasesModal` (que ahora solo aporta el `Modal` alrededor) para poder montarse también
 * como pestaña "databases" de la ficha unificada de usuario del motor (`ServerUserDetailPage`).
 *
 * Cada base enlaza a su ficha, también las `pending`/`error`: la ficha sabe decir que todavía no
 * existen en el motor y ofrece aprovisionarlas.
 */
export function OwnedDatabasesContent({ userId, enabled = true }: OwnedDatabasesContentProps) {
  const { data, isLoading, isError, error, refetch } = useOwnedDatabases(userId, enabled)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando…
      </div>
    )
  }
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />
  if ((data?.length ?? 0) === 0) {
    return <EmptyState title="Este usuario no posee bases de datos" />
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {data?.map((db) => (
        <li key={db.id} className="flex items-center justify-between py-2 text-sm">
          <Link
            to={serverDatabasePath(db.server_id, db.name)}
            className="font-medium text-primary hover:underline"
          >
            {db.name}
          </Link>
          <ProvisionStatusBadge status={db.status} />
        </li>
      ))}
    </ul>
  )
}
