import { Link } from 'react-router-dom'
import { Badge, Button, DataTable, EmptyState, ErrorState, RefreshIcon } from '@/components/ui'
import type { ModelDatabaseStatus } from '@/lib/contracts'
import type { ColumnDef } from '@tanstack/react-table'
import { useModelDatabases, useRefreshModelDatabases } from '../hooks/use-database-models'

interface ModelDatabasesStatusTableProps {
  modelId: number
  /** Abre el diálogo de aplicar con esta BD ya preseleccionada. */
  onApplyTo: (database: ModelDatabaseStatus) => void
}

/**
 * En qué versión está cada BD del blueprint y qué le falta.
 *
 * Antes esto no existía en ninguna pantalla: para saber si una BD estaba al día había que
 * entrar en su ficha, una por una. Ahora sale de una sola respuesta servida con datos locales
 * del gateway — **no abre conexiones a los motores**.
 *
 * La contrapartida de esa baratura es que `model_version` es una COPIA, sincronizada tras cada
 * apply. Si alguien migró una BD por fuera del gateway, el dato queda viejo hasta que se pulse
 * «Releer del motor», que es la única acción 🔌 de esta tabla.
 */
export function ModelDatabasesStatusTable({ modelId, onApplyTo }: ModelDatabasesStatusTableProps) {
  const databases = useModelDatabases(modelId, true)
  const refresh = useRefreshModelDatabases(modelId)

  const columns: ColumnDef<ModelDatabaseStatus>[] = [
    {
      accessorKey: 'name',
      header: 'Base de datos',
      cell: ({ row }) => (
        <Link
          to={`/managed-databases/${row.original.id}/migrations`}
          className="font-medium text-foreground hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'model_version',
      header: 'Versión actual',
      cell: ({ row }) => (
        <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
          {row.original.model_version ?? 'ninguna'}
        </code>
      ),
    },
    {
      accessorKey: 'pending_count',
      header: 'Pendientes',
      cell: ({ row }) => {
        const { pending_count: pending, pending_versions: versions } = row.original
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={pending > 0 ? 'warning' : 'success'}>
              {pending > 0 ? `${pending} pendiente(s)` : 'al día'}
            </Badge>
            {versions.length > 0 && (
              <span className="text-xs text-muted-foreground">{versions.join(', ')}</span>
            )}
          </span>
        )
      },
    },
    {
      id: 'flags',
      header: 'Estado',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {row.original.has_partial_application && (
            <Badge
              tone="error"
              title="Quedaron sentencias a medias: la versión actual no lo refleja"
            >
              aplicación parcial
            </Badge>
          )}
          {row.original.status === 'error' && <Badge tone="error">cuarentena</Badge>}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onApplyTo(row.original)}>
            Aplicar aquí 🔌
          </Button>
        </div>
      ),
    },
  ]

  if (databases.isError) {
    return <ErrorState error={databases.error} onRetry={() => void databases.refetch()} />
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          Versión conocida por el gateway, sincronizada tras cada aplicación. «Releer del motor» la
          comprueba de verdad contra cada BD.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          isLoading={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshIcon /> Releer del motor 🔌
        </Button>
      </div>
      <DataTable
        data={databases.data ?? []}
        columns={columns}
        isLoading={databases.isLoading}
        isFetching={databases.isFetching}
        searchPlaceholder="Buscar base de datos…"
        emptyState={
          <EmptyState
            title="Ninguna BD replica este blueprint"
            description="Asocia una base de datos gestionada al blueprint para poder aplicarle sus versiones."
          />
        }
      />
    </div>
  )
}
