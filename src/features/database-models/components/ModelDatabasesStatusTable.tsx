import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  EnvironmentBadge,
  ErrorState,
  RefreshIcon,
} from '@/components/ui'
import type { ModelDatabaseStatus } from '@/lib/contracts'
import type { ColumnDef } from '@tanstack/react-table'
import {
  useModelDatabases,
  useRefreshModelDatabases,
  useUpdateDatabaseModel,
} from '../hooks/use-database-models'
import { resolveEnvironmentState, useEnvironmentMap } from '@/features/environments'

/**
 * Collation en el que coinciden TODAS las BDs, o `null` si discrepan o no lo declaran.
 *
 * Solo se ofrece adoptar cuando hay unanimidad: con BDs en collations distintos no hay un
 * valor de referencia que deducir, y elegir uno por mayoría sería inventarse el esquema.
 */
function unanimousCollation(databases: ModelDatabaseStatus[]): string | null {
  const values = databases.map((db) => db.collation).filter((c): c is string => Boolean(c))
  if (values.length === 0 || values.length !== databases.length) return null
  const first = values[0]!
  return values.every((c) => c.toLowerCase() === first.toLowerCase()) ? first : null
}

interface ModelDatabasesStatusTableProps {
  modelId: number
  /** Collation de referencia declarado; si falta, se ofrece adoptar el de las BDs. */
  blueprintCollation?: string | null
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
export function ModelDatabasesStatusTable({
  modelId,
  blueprintCollation,
  onApplyTo,
}: ModelDatabasesStatusTableProps) {
  const databases = useModelDatabases(modelId, true)
  const refresh = useRefreshModelDatabases(modelId)
  const updateModel = useUpdateDatabaseModel(modelId)

  // Un blueprint sin collation declarado no puede avisar de un COLLATE forzado: la comparación
  // no tiene contra qué. Si sus BDs coinciden, ese valor ES el esquema de referencia de facto,
  // así que se ofrece declararlo en un clic en vez de pedir que lo teclee.
  const environmentMap = useEnvironmentMap()
  const adoptable = blueprintCollation ? null : unanimousCollation(databases.data ?? [])

  // `useMemo`: era el único sitio del repo que construía las columnas en cada render, y esta
  // tarea le agrega un join contra el catálogo de entornos (más re-renders).
  const columns: ColumnDef<ModelDatabaseStatus>[] = useMemo(
    () => [
    {
      accessorKey: 'name',
      header: 'Base de datos',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Link
            to={`/managed-databases/${row.original.id}/migrations`}
            className="font-medium text-foreground hover:underline"
          >
            {row.original.name}
          </Link>
          {/* Inline y no en columna propia, por el mismo criterio que el inventario. */}
          <EnvironmentBadge
            state={resolveEnvironmentState(row.original.environment_id, environmentMap)}
            className="shrink-0"
          />
        </div>
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
    ],
    // `onApplyTo` va en las deps: sin él, un `useMemo` que solo mira `environmentMap` congelaría
    // el handler de la primera render y el botón llamaría a un closure viejo. Si el padre no lo
    // envuelve en `useCallback`, las columnas se rearman por render — que es exactamente lo que
    // pasaba antes de memoizarlas, así que no es una regresión.
    [environmentMap, onApplyTo],
  )

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
      {adoptable && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            Este blueprint no declara collation de referencia y todas sus BDs usan{' '}
            <strong>{adoptable}</strong>. Declararlo permite avisar cuando una migración fuerza uno
            distinto.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            isLoading={updateModel.isPending}
            onClick={() => updateModel.mutate({ collation: adoptable })}
          >
            Declarar {adoptable}
          </Button>
        </div>
      )}
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
