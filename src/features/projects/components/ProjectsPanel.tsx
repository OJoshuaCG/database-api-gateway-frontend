import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  Pagination,
  PencilIcon,
  TrashIcon,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import type { ProjectOut } from '@/lib/contracts'
import { useProjects } from '../hooks/use-projects'
import { ProjectFormModal } from './ProjectFormModal'
import { DeleteProjectDialog } from './DeleteProjectDialog'

/**
 * Listado de proyectos (Vista 1 del plan), como contenido de la pestaña «Proyectos».
 *
 * `blueprint_count` se pinta directo del listado: el backend lo calcula con una sola query para
 * toda la página, así que no hay que pedir los blueprints de cada proyecto para contarlos —serían
 * 21 consultas para pintar una tabla de 20—.
 *
 * Un proyecto con **0 blueprints no lleva ningún aviso**: es el estado normal en el que nace con
 * el alta recomendada (sin `model_ids`). Un icono de alerta ahí enseñaría que hay algo que
 * arreglar cuando no lo hay.
 */
export function ProjectsPanel() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectOut | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<ProjectOut | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = useProjects({ page, size })

  const columns = useMemo<ColumnDef<ProjectOut>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Nombre',
        cell: ({ row }) => (
          <button
            type="button"
            className="text-left font-medium text-primary hover:underline"
            onClick={() => void navigate(`/projects/${row.original.id}`)}
          >
            {row.original.name}
          </button>
        ),
      },
      {
        accessorKey: 'description',
        header: 'Descripción',
        cell: ({ row }) => {
          const description = row.original.description
          if (!description) return <span className="text-muted-foreground">—</span>
          return (
            <span
              title={description}
              className="block max-w-md truncate text-muted-foreground"
            >
              {description}
            </span>
          )
        },
      },
      {
        accessorKey: 'blueprint_count',
        header: 'Blueprints',
        cell: ({ getValue }) => {
          const count = getValue<number>()
          return (
            <span className={count === 0 ? 'text-muted-foreground' : 'text-foreground'}>
              {count}
            </span>
          )
        },
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigate(`/projects/${row.original.id}`)}
            >
              Ver
            </Button>
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
        ),
      },
    ],
    [navigate],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Un proyecto agrupa blueprints. No toca ninguna base de datos.
        </p>
        <Button
          onClick={() => {
            setEditing(undefined)
            setFormOpen(true)
          }}
        >
          Nuevo proyecto
        </Button>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            isLoading={isLoading}
            isFetching={isFetching}
            // `GET /projects` no tiene búsqueda en servidor: el filtro es local sobre la página
            // cargada, y el texto lo dice. Un buscador que parece global pero solo mira 20 filas
            // es peor que no tener buscador.
            searchPlaceholder="Filtrar por nombre en esta página"
            emptyState={
              <EmptyState
                title="Todavía no hay proyectos."
                description="Un proyecto agrupa blueprints para que se vea qué bases pertenecen a la misma iniciativa."
                action={
                  <Button
                    onClick={() => {
                      setEditing(undefined)
                      setFormOpen(true)
                    }}
                  >
                    Crear el primer proyecto
                  </Button>
                }
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

      {formOpen && (
        <ProjectFormModal
          open
          onClose={() => setFormOpen(false)}
          project={editing}
          // Tras el alta se entra al proyecto: ahí está el panel para agregarle blueprints, que es
          // el paso que el alta deliberadamente no hace.
          onCreated={(created) => void navigate(`/projects/${created.id}`)}
        />
      )}

      <DeleteProjectDialog project={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  )
}
