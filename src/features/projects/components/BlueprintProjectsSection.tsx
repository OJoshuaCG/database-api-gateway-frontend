import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, CardContent, ErrorState, Spinner } from '@/components/ui'
import { useBlueprintProjects, useUnlinkProjectBlueprint } from '../hooks/use-projects'
import { UnlinkUndoBar } from './UnlinkUndoBar'

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
 *
 * **«Quitar de este proyecto» se comporta igual que en el detalle del proyecto** (regla R1: la
 * misma acción, vista desde el otro extremo del vínculo): sin confirmación y con una barra de
 * deshacer. Antes acá se quitaba sin red, y una misma acción no puede ser reversible en una
 * pantalla e irreversible en otra.
 */
export function BlueprintProjectsSection({ modelId }: BlueprintProjectsSectionProps) {
  const projects = useBlueprintProjects(modelId, Number.isFinite(modelId))
  /**
   * Último proyecto del que se quitó el blueprint. Vive en la sección y no en la fila porque la
   * fila DESAPARECE al invalidarse la lista: si el deshacer viviera ahí, se desmontaría junto con
   * el vínculo que tiene que restaurar.
   */
  const [undoTarget, setUndoTarget] = useState<{ id: number; name: string } | null>(null)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <span className="text-sm font-medium text-foreground">Proyectos</span>

        {undoTarget && (
          <UnlinkUndoBar
            // `key` por proyecto: el hook de revinculación está parametrizado con su id, y un
            // segundo «Quitar» tiene que estrenar hook y no heredar el `isPending` del anterior.
            key={undoTarget.id}
            projectId={undoTarget.id}
            modelId={modelId}
            onDone={() => setUndoTarget(null)}
          >
            Quitado de <strong className="font-semibold text-foreground">{undoTarget.name}</strong>{' '}
            (el blueprint no se borró).
          </UnlinkUndoBar>
        )}

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
              <ProjectChip
                key={project.id}
                modelId={modelId}
                project={project}
                onUnlinked={() => setUndoTarget({ id: project.id, name: project.name })}
              />
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
  onUnlinked: () => void
}

/**
 * Una fila de la vista inversa. El hook de desvinculación se instancia **por proyecto** porque
 * está parametrizado con el `projectId`, que es distinto en cada fila.
 */
function ProjectChip({ modelId, project, onUnlinked }: ProjectChipProps) {
  const unlink = useUnlinkProjectBlueprint(project.id)

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <span className="font-medium text-foreground">{project.name}</span>
      <span className="text-xs text-muted-foreground">({project.blueprint_count} blueprints)</span>
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
          // Sin confirmación, como en el detalle del proyecto: a cambio, la barra de deshacer.
          onClick={() => unlink.mutate(modelId, { onSuccess: onUnlinked })}
        >
          Quitar de este proyecto
        </Button>
      </div>
    </li>
  )
}
