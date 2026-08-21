import { Badge, Button, DataTable, EmptyState } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import type { ModelMigrationSummary } from '@/lib/contracts'
import type { ColumnDef } from '@tanstack/react-table'

interface VersionsTableProps {
  versions: ModelMigrationSummary[]
  isLoading?: boolean
  selectedVersion: string | null
  onSelect: (version: string) => void
}

/**
 * Listado de versiones del blueprint con lo que de verdad hace cada una.
 *
 * El desplegable del navegador sirve para MOVERSE entre versiones, pero no para escanearlas:
 * con cuatro insignias por fila hay que poder recorrerlas de un vistazo y comparar. Por eso
 * esta tabla existe además del navegador, no en su lugar.
 *
 * 🌱, ⚑ collate y ⚠ destructiva salen del SQL, no de un campo declarado: describen lo que la
 * migración hace, no lo que alguien dijo que hacía.
 */
export function VersionsTable({
  versions,
  isLoading,
  selectedVersion,
  onSelect,
}: VersionsTableProps) {
  const columns: ColumnDef<ModelMigrationSummary>[] = [
    {
      accessorKey: 'version',
      header: 'Versión',
      cell: ({ row }) => (
        <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
          {row.original.version}
        </code>
      ),
    },
    { accessorKey: 'name', header: 'Nombre' },
    {
      id: 'facts',
      header: 'Contenido',
      enableSorting: false,
      cell: ({ row }) => {
        const m = row.original
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {m.is_baseline && <Badge tone="info">baseline</Badge>}
            {m.has_seed && (
              <Badge tone="info" title="Inserta o modifica datos">
                🌱 siembra
              </Badge>
            )}
            {m.forced_collations.length > 0 && (
              <Badge tone="warning" title={m.forced_collations.join(', ')}>
                ⚑ collate
              </Badge>
            )}
            {m.destructive && (
              <Badge tone="error" title="Contiene DROP o TRUNCATE">
                ⚠ destructiva
              </Badge>
            )}
            {m.capture_selects && (
              <Badge
                tone={m.reviewed === false ? 'warning' : 'info'}
                title="Guarda el resultado de sus SELECT en el gateway"
              >
                🔒 captura
              </Badge>
            )}
            {m.has_non_portable && <Badge tone="warning">no portable</Badge>}
          </span>
        )
      },
    },
    {
      id: 'state',
      header: 'Estado',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {row.original.reviewed === false && <Badge tone="warning">sin revisar</Badge>}
          {row.original.sql_frozen && (
            <Badge tone="neutral" title="Alguna BD ya depende de ella: su SQL no se edita">
              SQL congelado
            </Badge>
          )}
          {row.original.has_rollback ? (
            <Badge tone="success">↩ rollback</Badge>
          ) : (
            <Badge tone="warning" title="Un rollback que atraviese esta versión fallará con 409">
              sin rollback
            </Badge>
          )}
        </span>
      ),
    },
    {
      accessorKey: 'created_at',
      header: 'Creada',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDateTime(row.original.created_at)}
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
          <Button
            variant={row.original.version === selectedVersion ? 'outline' : 'ghost'}
            size="sm"
            onClick={() => onSelect(row.original.version)}
          >
            Ver detalle
          </Button>
        </div>
      ),
    },
  ]

  return (
    <DataTable
      data={versions}
      columns={columns}
      isLoading={isLoading}
      searchPlaceholder="Buscar versión…"
      getRowId={(row) => row.version}
      emptyState={
        <EmptyState
          title="Sin migraciones"
          description="Crea la primera migración (delta SQL) de este blueprint."
        />
      }
    />
  )
}
