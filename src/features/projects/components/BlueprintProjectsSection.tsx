import { Link } from 'react-router-dom'
import { Button, Card, CardContent, ErrorState, Spinner } from '@/components/ui'
import { useBlueprintProjects, useUnlinkProjectBlueprint } from '../hooks/use-projects'

interface BlueprintProjectsSectionProps {
  modelId: number
}

/**
 * Vista inversa (§3.9): a qué proyectos pertenece **este** blueprint.
 *
 * Va dentro de la pantalla del blueprint, no en una propia. Que la lista venga vacía **no es un
 * dato faltante que haya que completar**: un blueprint sin proyecto es un estado normal, así que
 * el texto es neutro y no hay CTA de «arreglarlo».
 *
 * Su carga no bloquea el resto de la pantalla: si falla, la sección muestra su propio error y las
 * versiones del blueprint siguen funcionando.
 */
export function BlueprintProjectsSection({ modelId }: BlueprintProjectsSectionProps) {
  const projects = useBlueprintProjects(modelId, Number.isFinite(modelId))

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <span className="text-sm font-medium text-foreground">Proyectos</span>

        {projects.isError ? (
          <ErrorState
            error={projects.error}
            title="No se pudieron cargar los proyectos"
            onRetry={() => void projects.refetch()}
          />
        ) : projects.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando proyectos…
          </div>
        ) : (projects.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este blueprint no pertenece a ningún proyecto.{' '}
            <Link to="/database-models?tab=proyectos" className="text-primary hover:underline">
              Ver proyectos
            </Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(projects.data ?? []).map((project) => (
              <ProjectChip key={project.id} modelId={modelId} project={project} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

interface ProjectChipProps {
  modelId: number
  project: { id: number; name: string; blueprint_count: number }
}

/**
 * Una fila de la vista inversa. El hook de desvinculación se instancia **por proyecto** porque
 * está parametrizado con el `projectId`, que es distinto en cada fila.
 */
function ProjectChip({ modelId, project }: ProjectChipProps) {
  const unlink = useUnlinkProjectBlueprint(project.id)

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <span className="font-medium text-foreground">{project.name}</span>
      <span className="text-xs text-muted-foreground">
        ({project.blueprint_count} blueprints)
      </span>
      <div className="ml-auto flex gap-1.5">
        <Link
          to={`/projects/${project.id}`}
          className="rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
        >
          Ver proyecto
        </Link>
        <Button
          variant="ghost"
          size="sm"
          isLoading={unlink.isPending}
          onClick={() => unlink.mutate(modelId)}
        >
          Quitar de este proyecto
        </Button>
      </div>
    </li>
  )
}
