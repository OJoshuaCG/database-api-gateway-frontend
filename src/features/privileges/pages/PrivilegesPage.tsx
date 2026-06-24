import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Combobox,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Switch,
} from '@/components/ui'
import { engineTypeSchema, type EngineType, type PrivilegeOut } from '@/lib/contracts'
import { usePrivileges, useTogglePrivilege } from '../hooks/use-privileges'

interface EngineOption {
  value: EngineType
  label: string
}

const ENGINE_OPTIONS: EngineOption[] = engineTypeSchema.options.map((value) => ({
  value,
  label: value,
}))

export function PrivilegesPage() {
  const [engineFilter, setEngineFilter] = useState<EngineOption | null>(null)
  const [onlyActive, setOnlyActive] = useState(false)

  const { data, isLoading, isFetching, isError, error, refetch } = usePrivileges({
    engine: engineFilter?.value,
    active: onlyActive ? true : undefined,
  })
  const toggle = useTogglePrivilege()

  const columns = useMemo<ColumnDef<PrivilegeOut>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Privilegio',
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
      },
      {
        accessorKey: 'engine',
        header: 'Motor',
        cell: ({ getValue }) => <Badge tone="info">{getValue<string>()}</Badge>,
      },
      {
        accessorKey: 'category',
        header: 'Categoría',
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        id: 'context',
        header: 'Contexto',
        accessorFn: (row) => row.context ?? '—',
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'description',
        header: 'Descripción',
        enableSorting: false,
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'is_sensitive',
        header: 'Sensible',
        cell: ({ row }) =>
          row.original.is_sensitive ? (
            <Badge tone="warning">Sensible</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'is_active',
        header: 'Controlado',
        enableSorting: false,
        cell: ({ row }) => (
          <Switch
            checked={row.original.is_active}
            disabled={toggle.isPending}
            onCheckedChange={(checked) => toggle.mutate({ id: row.original.id, isActive: checked })}
            label=""
          />
        ),
      },
    ],
    [toggle],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Privilegios"
        description="Catálogo de privilegios que la plataforma controla por motor. No toca ningún motor."
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          data={data ?? []}
          columns={columns}
          isLoading={isLoading}
          isFetching={isFetching}
          searchPlaceholder="Buscar privilegio…"
          clientPageSize={15}
          toolbar={
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
              <div className="w-full sm:max-w-xs">
                <Combobox<EngineOption>
                  items={ENGINE_OPTIONS}
                  value={engineFilter}
                  onChange={setEngineFilter}
                  itemToString={(o) => o.label}
                  itemToKey={(o) => o.value}
                  label="Motor"
                  placeholder="Todos"
                  clearable
                />
              </div>
              <div className="pb-1">
                <Switch
                  checked={onlyActive}
                  onCheckedChange={setOnlyActive}
                  label="Solo controlados"
                />
              </div>
            </div>
          }
          emptyState={<EmptyState title="No hay privilegios para este filtro" />}
        />
      )}
    </div>
  )
}
