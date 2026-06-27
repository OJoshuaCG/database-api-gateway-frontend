import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import type { DatabaseModelOut } from '@/lib/contracts'
import { useDatabaseModels, useDeleteDatabaseModel } from '../hooks/use-database-models'
import { DatabaseModelFormModal } from '../components/DatabaseModelFormModal'
import { ModelDatabasesModal } from '../components/ModelDatabasesModal'
import { ModelMigrationsModal } from '../components/ModelMigrationsModal'

export function DatabaseModelsPage() {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<DatabaseModelOut | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<DatabaseModelOut | null>(null)
  const [databasesTarget, setDatabasesTarget] = useState<DatabaseModelOut | null>(null)
  const [migrationsTarget, setMigrationsTarget] = useState<DatabaseModelOut | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = useDatabaseModels({ page, size })
  const deleteModel = useDeleteDatabaseModel()

  const columns = useMemo<ColumnDef<DatabaseModelOut>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Nombre',
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
      },
      {
        accessorKey: 'slug',
        header: 'Slug',
        cell: ({ getValue }) => (
          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {getValue<string>()}
          </code>
        ),
      },
      {
        accessorKey: 'current_version',
        header: 'Versión',
        cell: ({ getValue }) => <Badge tone="info">{getValue<string>()}</Badge>,
      },
      {
        accessorKey: 'is_active',
        header: 'Estado',
        cell: ({ row }) => (
          <Badge tone={row.original.is_active ? 'success' : 'neutral'}>
            {row.original.is_active ? 'Activo' : 'Inactivo'}
          </Badge>
        ),
      },
      {
        accessorKey: 'created_at',
        header: 'Creado',
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{formatDateTime(getValue<string>())}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setMigrationsTarget(row.original)}>
              Migraciones
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDatabasesTarget(row.original)}>
              Ver BDs
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(row.original)
                setFormOpen(true)
              }}
            >
              Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(row.original)}>
              Eliminar
            </Button>
          </div>
        ),
      },
    ],
    [],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Blueprints"
        description="Categorías lógicas reutilizables de bases de datos (metadato de inventario)."
        actions={
          <Button
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            Crear blueprint
          </Button>
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            isLoading={isLoading}
            isFetching={isFetching}
            searchPlaceholder="Buscar blueprint…"
            emptyState={
              <EmptyState
                title="No hay blueprints"
                description="Crea un blueprint para categorizar tus bases de datos."
              />
            }
          />
          {data && data.items.length > 0 && (
            <Pagination
              page={data.pagination.page}
              pages={data.pagination.pages}
              total={data.pagination.total}
              size={data.pagination.size}
              hasNext={data.pagination.has_next}
              hasPrev={data.pagination.has_prev}
              onPageChange={setPage}
              onSizeChange={(next) => {
                setSize(next)
                setPage(1)
              }}
              isFetching={isFetching}
            />
          )}
        </>
      )}

      <DatabaseModelFormModal open={formOpen} onClose={() => setFormOpen(false)} model={editing} />
      <ModelDatabasesModal model={databasesTarget} onClose={() => setDatabasesTarget(null)} />
      <ModelMigrationsModal
        key={migrationsTarget?.id ?? 'closed'}
        model={migrationsTarget}
        onClose={() => setMigrationsTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return
          deleteModel.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
        }}
        title="Eliminar blueprint"
        description={`Se eliminará «${deleteTarget?.name}». Las bases de datos asociadas no se modifican.`}
        confirmLabel="Eliminar"
        isLoading={deleteModel.isPending}
      />
    </div>
  )
}
