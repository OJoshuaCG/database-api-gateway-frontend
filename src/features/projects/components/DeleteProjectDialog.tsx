import { ConfirmDialog } from '@/components/ui'
import type { DatabaseModelOut, ProjectOut } from '@/lib/contracts'
import { useDeleteProject } from '../hooks/use-projects'

/** Cuántos nombres se listan antes de resumir el resto en «y N más». */
const NAMES_SHOWN = 5

interface DeleteProjectDialogProps {
  /** `null` = cerrado. Se monta con el proyecto para que el diálogo nazca con datos frescos. */
  project: ProjectOut | null
  /** Blueprints ya cargados, si la pantalla los tiene: solo para nombrarlos y tranquilizar. */
  blueprints?: DatabaseModelOut[]
  onClose: () => void
  onDeleted?: () => void
}

/**
 * Confirmación del borrado de un proyecto — **deliberadamente simple**.
 *
 * Sin `confirmWord`, sin `confirm_token`, sin cuenta atrás. Borrar un proyecto **no borra
 * blueprints**: borra la entidad y sus vínculos, y esa regla está implementada en tres capas del
 * backend. Copiar aquí el ceremonial del `DROP DATABASE` no aportaría seguridad, le enseñaría al
 * operador que todo es peligroso — y la fricción es un recurso finito que hay que gastar donde
 * de verdad importa, no en una operación de organización.
 *
 * Por el mismo motivo la lista de blueprints que quedan intactos está para **tranquilizar**, no
 * para advertir: nada de iconos de peligro junto a los nombres.
 */
export function DeleteProjectDialog({
  project,
  blueprints,
  onClose,
  onDeleted,
}: DeleteProjectDialogProps) {
  const remove = useDeleteProject()
  if (!project) return null

  const count = project.blueprint_count
  const names = (blueprints ?? []).map((blueprint) => blueprint.name)
  const shown = names.slice(0, NAMES_SHOWN)
  const rest = names.length - shown.length

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() =>
        remove.mutate(project.id, {
          onSuccess: () => {
            onClose()
            onDeleted?.()
          },
        })
      }
      title={`¿Eliminar el proyecto «${project.name}»?`}
      confirmLabel="Eliminar proyecto"
      isLoading={remove.isPending}
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Se elimina el proyecto y sus vínculos. Los {count} blueprint(s) que agrupa{' '}
          <strong className="font-semibold text-foreground">NO se borran</strong>: siguen existiendo
          con sus migraciones, sus bases de datos y su historial.
        </p>
        <p className="text-sm text-muted-foreground">
          Esto es una operación de organización, no de datos.
        </p>
        {shown.length > 0 && (
          <p className="rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
            Quedan intactos: {shown.join(', ')}
            {rest > 0 ? ` y ${rest} más` : ''}.
          </p>
        )}
      </div>
    </ConfirmDialog>
  )
}
