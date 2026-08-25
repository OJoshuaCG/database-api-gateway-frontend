import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  PageHeader,
  Spinner,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import { toApiError } from '@/lib/api/errors'
import { PROJECT_ERROR_CODES, type DatabaseModelOut } from '@/lib/contracts'
import { useToast } from '@/lib/toast/use-toast'
import {
  useLinkProjectBlueprints,
  useProject,
  useProjectBlueprints,
  useUnlinkProjectBlueprint,
} from '../hooks/use-projects'
import { ProjectFormModal } from '../components/ProjectFormModal'
import { DeleteProjectDialog } from '../components/DeleteProjectDialog'
import { LinkBlueprintsModal } from '../components/LinkBlueprintsModal'

/**
 * Detalle de un proyecto y gestión de sus blueprints (Vista 3 del plan).
 *
 * La cabecera y la lista son **dos llamadas independientes**, y se pintan como tales: si falla la
 * lista, la cabecera sigue en pantalla con su propio banner de reintento. Un fallo parcial no
 * debe tumbar la pantalla entera.
 */
export function ProjectDetailPage() {
  const params = useParams()
  const projectId = Number(params.projectId)
  const navigate = useNavigate()
  const toast = useToast()

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  /** Último blueprint desvinculado: sostiene la barra de deshacer. */
  const [undoTarget, setUndoTarget] = useState<DatabaseModelOut | null>(null)

  const project = useProject(projectId, Number.isFinite(projectId))
  const blueprints = useProjectBlueprints(projectId, Number.isFinite(projectId))
  const unlink = useUnlinkProjectBlueprint(projectId)
  const relink = useLinkProjectBlueprints(projectId)

  // El backend ordena por id descendente (no es parte del contrato declarado), así que la lista
  // se reordena por nombre en cliente: es el orden con el que el operador la busca.
  const sorted = useMemo(
    () => [...(blueprints.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [blueprints.data],
  )
  const linkedIds = useMemo(() => sorted.map((item) => item.id), [sorted])

  if (Number.isNaN(projectId)) {
    return <ErrorState error={new Error('Identificador de proyecto inválido.')} />
  }
  if (project.isLoading) return <FullPageSpinner label="Cargando proyecto" />

  if (project.isError || !project.data) {
    const apiError = toApiError(project.error)
    const gone = apiError.code === PROJECT_ERROR_CODES.notFound
    return (
      <div className="flex flex-col gap-4">
        <ErrorState
          error={project.error}
          title={gone ? 'Este proyecto ya no existe.' : undefined}
          onRetry={gone ? undefined : () => void project.refetch()}
        />
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void navigate('/database-models?tab=proyectos')}>
            Volver al listado
          </Button>
        </div>
      </div>
    )
  }

  const data = project.data

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          to="/database-models?tab=proyectos"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Volver a Proyectos
        </Link>
        <PageHeader
          title={data.name}
          description={data.description ?? 'Sin descripción'}
          actions={
            <>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                Editar
              </Button>
              <Button variant="danger-soft" onClick={() => setDeleteOpen(true)}>
                Eliminar proyecto
              </Button>
            </>
          }
        />
        <p className="mt-1 text-xs text-muted-foreground">
          creado {formatDateTime(data.created_at)} · actualizado {formatDateTime(data.updated_at)} ·{' '}
          {data.blueprint_count} blueprint(s)
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">Blueprints del proyecto</span>
            <Badge tone="info">{data.blueprint_count}</Badge>
            <Button className="ml-auto" size="sm" onClick={() => setLinkOpen(true)}>
              Agregar blueprints
            </Button>
          </div>

          {undoTarget && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
              <span>
                <strong className="font-semibold text-foreground">{undoTarget.name}</strong> quitado
                del proyecto (el blueprint no se borró).
              </span>
              <Button
                variant="outline"
                size="sm"
                isLoading={relink.isPending}
                onClick={() =>
                  relink.mutate([undoTarget.id], {
                    // Repetir el deshacer es inofensivo: la vinculación es idempotente y el id
                    // repetido vuelve en `already_linked`. No hay carrera que proteger.
                    onSuccess: () => setUndoTarget(null),
                  })
                }
              >
                Deshacer
              </Button>
            </div>
          )}

          {blueprints.isError ? (
            <ErrorState error={blueprints.error} onRetry={() => void blueprints.refetch()} />
          ) : blueprints.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Cargando blueprints…
            </div>
          ) : sorted.length === 0 ? (
            <EmptyState
              title="Este proyecto todavía no agrupa ningún blueprint."
              action={<Button onClick={() => setLinkOpen(true)}>Agregar blueprints</Button>}
            />
          ) : (
            <>
              {/* Sin paginador: el endpoint devuelve la lista completa y no acepta page/size. */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Nombre</th>
                      <th className="py-2 pr-3 font-medium">Slug</th>
                      <th className="py-2 pr-3 font-medium">Versión</th>
                      <th className="py-2 pr-3 font-medium">Activo</th>
                      <th className="py-2 pr-3 font-medium">Charset / Collation</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((item) => (
                      <tr key={item.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3">
                          <Link
                            to={`/database-models/${item.id}/migrations`}
                            className="font-medium text-primary hover:underline"
                          >
                            {item.name}
                          </Link>
                        </td>
                        <td className="py-2 pr-3">
                          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {item.slug}
                          </code>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone="info">{item.current_version}</Badge>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={item.is_active ? 'success' : 'neutral'}>
                            {item.is_active ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {item.charset ? `${item.charset} / ${item.collation ?? '—'}` : '—'}
                        </td>
                        <td className="py-2 text-right">
                          {/* Sin confirmación: un confirm() aquí es fricción sin contenido.
                              A cambio, la barra de deshacer de arriba. */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              unlink.mutate(item.id, { onSuccess: () => setUndoTarget(item) })
                            }
                          >
                            Quitar del proyecto
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Quitar un blueprint del proyecto no lo borra ni afecta a sus bases de datos.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {editOpen && (
        <ProjectFormModal open onClose={() => setEditOpen(false)} project={data} />
      )}

      {linkOpen && (
        <LinkBlueprintsModal
          open
          onClose={() => setLinkOpen(false)}
          project={data}
          linkedIds={linkedIds}
          onLinked={(result) => {
            const added = result.linked.length
            const already = result.already_linked.length
            // Una sola frase de éxito. `already_linked` NO es una advertencia: es la operación
            // funcionando, y presentarlo como problema enseña a desconfiar de algo que es seguro.
            if (added > 0 && already > 0) {
              toast.success(
                `${added} blueprint(s) agregado(s).`,
                `${already} ya estaban en el proyecto.`,
              )
            } else if (added > 0) {
              toast.success(`${added} blueprint(s) agregado(s) al proyecto.`)
            } else {
              toast.success('Esos blueprints ya estaban en el proyecto.', 'No hizo falta ningún cambio.')
            }
          }}
        />
      )}

      {deleteOpen && (
        <DeleteProjectDialog
          project={data}
          blueprints={sorted}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => void navigate('/database-models?tab=proyectos')}
        />
      )}
    </div>
  )
}
