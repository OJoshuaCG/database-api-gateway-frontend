import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  Callout,
  Combobox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  PencilIcon,
  TrashIcon,
} from '@/components/ui'
import { CapabilityHint, useCapabilityGuard } from '@/features/auth'
import { formatDateTime } from '@/lib/utils'
import { CAPABILITIES, type EngineType, type PermissionProfileOut } from '@/lib/contracts'
import { usePermissionProfiles, useDeletePermissionProfile } from '../hooks/use-permission-profiles'
import { PermissionProfileFormModal } from '../components/PermissionProfileFormModal'

interface EngineFilter {
  value: EngineType
  label: string
}

const ENGINE_FILTERS: EngineFilter[] = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'postgresql', label: 'PostgreSQL' },
]

export function PermissionProfilesPage() {
  const [engine, setEngine] = useState<EngineFilter | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PermissionProfileOut | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<PermissionProfileOut | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = usePermissionProfiles({
    engine: engine?.value,
  })
  const deleteProfile = useDeletePermissionProfile()
  // Los perfiles son la plantilla de GRANTs: escribirlos es `catalogs.write` (de
  // `security_officer`). Sin ella, «Crear perfil» va deshabilitado con el motivo y las filas
  // esconden editar/eliminar, con un único aviso sobre la tabla.
  const writeGuard = useCapabilityGuard(CAPABILITIES.catalogsWrite, 'crear perfiles de permisos')
  const canWrite = writeGuard.allowed

  const columns = useMemo<ColumnDef<PermissionProfileOut>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Nombre',
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
      },
      {
        accessorKey: 'engine',
        header: 'Motor',
        cell: ({ getValue }) => <Badge tone="info">{getValue<string>()}</Badge>,
      },
      {
        id: 'items',
        header: 'Items',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.items.map((item) => item.level).join(', ') || '—'}
          </span>
        ),
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
        cell: ({ row }) =>
          canWrite ? (
            <div className="flex justify-end gap-1">
              <IconButton
                label="Editar"
                icon={<PencilIcon />}
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setEditing(row.original)
                  setFormOpen(true)
                }}
              />
              <IconButton
                label="Eliminar"
                icon={<TrashIcon />}
                variant="danger-soft"
                size="icon-sm"
                onClick={() => setDeleteTarget(row.original)}
              />
            </div>
          ) : null,
      },
    ],
    [canWrite],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Perfiles de permisos"
        description="Plantillas de privilegios por motor, reutilizables al aplicar permisos a un usuario."
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button
              disabled={!canWrite}
              aria-describedby={writeGuard.describedBy}
              onClick={() => {
                setEditing(undefined)
                setFormOpen(true)
              }}
            >
              Crear perfil
            </Button>
            <CapabilityHint guard={writeGuard} className="max-w-xs text-right" />
          </div>
        }
      />

      {!canWrite && (
        <Callout tone="info" title="Podés ver los perfiles, pero no cambiarlos">
          <p>Con tu acceso podés ver y usar estos perfiles, pero no editarlos ni eliminarlos.</p>
        </Callout>
      )}

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          data={data ?? []}
          columns={columns}
          isLoading={isLoading}
          isFetching={isFetching}
          searchPlaceholder="Buscar perfil…"
          clientPageSize={20}
          toolbar={
            <div className="w-full sm:max-w-xs">
              <Combobox<EngineFilter>
                items={ENGINE_FILTERS}
                value={engine}
                onChange={setEngine}
                itemToString={(option) => option.label}
                itemToKey={(option) => option.value}
                label="Filtrar por motor"
                placeholder="Todos los motores"
                clearable
              />
            </div>
          }
          emptyState={
            <EmptyState
              title="No hay perfiles de permisos"
              description="Crea un perfil para aplicar conjuntos de privilegios de forma reutilizable."
            />
          }
        />
      )}

      <PermissionProfileFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        profile={editing}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return
          deleteProfile.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
        }}
        title="Eliminar perfil de permisos"
        description={`Se eliminará «${deleteTarget?.name}». No afecta a permisos ya aplicados.`}
        confirmLabel="Eliminar"
        isLoading={deleteProfile.isPending}
      />
    </div>
  )
}
