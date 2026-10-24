import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  Pagination,
  PencilIcon,
  TrashIcon,
} from '@/components/ui'
import { CapabilityHint, useCapabilityGuard } from '@/features/auth'
import { useEnvironmentMap } from '@/features/environments'
import { CAPABILITIES, PAGINATION, type ReleaseChannelOut } from '@/lib/contracts'
import { useReleaseChannels } from '../hooks/use-release-channels'
import { RELEASE_CHANNELS_WRITE_UNBLOCK, releaseChannelModeLabel } from '../messages'
import { DeleteReleaseChannelDialog } from './DeleteReleaseChannelDialog'
import { ReleaseChannelFormModal } from './ReleaseChannelFormModal'

/**
 * Catálogo de canales de liberación, como pestaña de Administración (junto a Entornos: son el
 * otro catálogo global de política).
 *
 * Leer lo puede cualquier rol; escribir (crear, editar, borrar) exige `release_channels.write`,
 * que es solo de `security_officer`. Los controles de escritura van deshabilitados con el motivo
 * a la vista y no escondidos: la pantalla tiene que decir quién puede, y cómo desbloquearlo.
 *
 * El entorno enlazado se resuelve en cliente con el catálogo de entornos compartido. Mientras
 * ese catálogo carga o si falla, se muestra el id crudo: nunca una celda vacía, que se leería
 * como «sin entorno».
 */
export function ReleaseChannelsPanel() {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState<number>(PAGINATION.defaultSize)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ReleaseChannelOut | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<ReleaseChannelOut | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = useReleaseChannels({
    page,
    size,
  })
  const environments = useEnvironmentMap()
  const guard = useCapabilityGuard(
    CAPABILITIES.releaseChannelsWrite,
    'crear, editar o borrar canales de liberación',
  )

  const openCreate = () => {
    setEditing(undefined)
    setFormOpen(true)
  }

  const columns = useMemo<ColumnDef<ReleaseChannelOut>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Canal',
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium text-foreground">{row.original.name}</span>
            <code className="text-xs text-muted-foreground">{row.original.slug}</code>
          </span>
        ),
      },
      {
        accessorKey: 'resolution_mode',
        header: 'Modo',
        cell: ({ row }) => (
          <Badge tone="info">{releaseChannelModeLabel(row.original.resolution_mode)}</Badge>
        ),
      },
      {
        accessorKey: 'environment_id',
        header: 'Entorno',
        cell: ({ row }) => {
          const environmentId = row.original.environment_id
          if (environmentId === null) return <span className="text-muted-foreground">—</span>
          const environment = environments.byId.get(environmentId)
          return <span>{environment ? environment.name : `#${environmentId}`}</span>
        },
      },
      {
        accessorKey: 'pointer_count',
        header: 'Punteros',
        cell: ({ row }) => (
          <span
            className={
              row.original.pointer_count === 0 ? 'text-muted-foreground' : 'text-foreground'
            }
          >
            {row.original.pointer_count}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1.5">
            <IconButton
              label={`Editar ${row.original.name}`}
              icon={<PencilIcon />}
              variant="ghost"
              size="icon-sm"
              disabled={!guard.allowed}
              aria-describedby={guard.describedBy}
              onClick={() => {
                setEditing(row.original)
                setFormOpen(true)
              }}
            />
            <IconButton
              label={`Borrar ${row.original.name}`}
              icon={<TrashIcon />}
              variant="danger-soft"
              size="icon-sm"
              disabled={!guard.allowed}
              aria-describedby={guard.describedBy}
              onClick={() => setDeleteTarget(row.original)}
            />
          </div>
        ),
      },
    ],
    [environments.byId, guard.allowed, guard.describedBy],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Canales de liberación</CardTitle>
        <CardDescription>
          Un canal (<code>stable</code>, <code>development</code>…) decide qué versión de un
          blueprint consumen las integraciones. Es configuración del gateway: no toca ninguna base
          de datos. El puntero de cada blueprint se mueve desde su pantalla de migraciones.
        </CardDescription>
        {/* Quién escribe y cómo desbloquearlo: la API los pide a `release_channels.write`. */}
        <p className="text-sm text-muted-foreground">{RELEASE_CHANNELS_WRITE_UNBLOCK}</p>
        <CapabilityHint guard={guard} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex justify-end">
          <Button
            disabled={!guard.allowed}
            aria-describedby={guard.describedBy}
            onClick={openCreate}
          >
            Nuevo canal
          </Button>
        </div>

        {isError ? (
          <ErrorState
            error={error}
            title="No se pudo cargar el catálogo de canales"
            onRetry={() => void refetch()}
          />
        ) : (
          <>
            <DataTable
              data={data?.items ?? []}
              columns={columns}
              isLoading={isLoading}
              isFetching={isFetching}
              // `GET /release-channels` no tiene búsqueda en servidor: el filtro es local sobre la
              // página cargada, y el texto lo dice.
              searchPlaceholder="Filtrar por nombre en esta página"
              emptyState={
                <EmptyState
                  title="Todavía no hay canales de liberación."
                  description="Sin canales, las integraciones solo pueden pedir la última versión de cada blueprint."
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
      </CardContent>

      {formOpen && (
        <ReleaseChannelFormModal open onClose={() => setFormOpen(false)} channel={editing} />
      )}
      <DeleteReleaseChannelDialog channel={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </Card>
  )
}
