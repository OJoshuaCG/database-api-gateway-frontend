import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Input, Modal, Textarea } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_ERROR_CODES,
  PROJECT_NAME_MAX,
  type ProjectOut,
} from '@/lib/contracts'
import { useCreateProject, useUpdateProject } from '../hooks/use-projects'

interface ProjectFormValues {
  name: string
  description: string
}

/**
 * Validación en cliente, no como adorno: en producción el 422 de Pydantic **no trae detalle por
 * campo** (`detail.context` solo existe en `development`), así que el único texto disponible sería
 * un «Error de validación en: name». El 422 del backend es la red de seguridad; el mecanismo de
 * feedback es este schema.
 */
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'El nombre no puede ser solo espacios.')
    .max(PROJECT_NAME_MAX, `Máximo ${PROJECT_NAME_MAX} caracteres`),
  description: z
    .string()
    .max(PROJECT_DESCRIPTION_MAX, `Máximo ${PROJECT_DESCRIPTION_MAX} caracteres`),
})

interface ProjectFormModalProps {
  open: boolean
  onClose: () => void
  /** Ausente = alta. Presente = edición. */
  project?: ProjectOut
  /** Alta: permite navegar al proyecto recién creado para que agregue blueprints ahí. */
  onCreated?: (project: ProjectOut) => void
}

export function ProjectFormModal({ open, onClose, project, onCreated }: ProjectFormModalProps) {
  const isEdit = project !== undefined
  const create = useCreateProject()
  const update = useUpdateProject(project?.id ?? 0)
  const isSubmitting = create.isPending || update.isPending

  // El 409 `project.name_taken` se muestra **inline en Nombre**, no como toast: se resuelve
  // cambiando un dato que el usuario escribió, así que el mensaje tiene que estar junto al campo
  // que hay que corregir. Ofrecer «reintentar» aquí sería un bucle.
  const [nameConflict, setNameConflict] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setFocus,
    formState: { errors },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: project?.name ?? '',
      description: project?.description ?? '',
    },
  })

  const name = watch('name')
  const description = watch('description')

  const handleError = (error: unknown) => {
    const apiError = toApiError(error)
    if (apiError.code === PROJECT_ERROR_CODES.nameTaken) {
      setNameConflict('Ya existe un proyecto con ese nombre.')
      setFocus('name')
    }
  }

  const submit = (values: ProjectFormValues) => {
    setNameConflict(null)
    const trimmedName = values.name.trim()
    const trimmedDescription = values.description.trim()

    if (isEdit) {
      update.mutate(
        {
          name: trimmedName,
          // `null` explícito vacía la descripción; mandar `''` guardaría una cadena vacía, que
          // no es lo mismo. Es la única forma de expresar «bórrala» en un PATCH parcial.
          description: trimmedDescription === '' ? null : trimmedDescription,
        },
        { onSuccess: onClose, onError: handleError },
      )
      return
    }

    // El alta va SIN `model_ids` a propósito: si alguno no existiera, el backend responde 422
    // con el proyecto YA creado, y reintentar el alta daría 409 por el nombre que acaba de tomar.
    // Los blueprints se vinculan después, desde el detalle.
    create.mutate(
      {
        name: trimmedName,
        description: trimmedDescription === '' ? null : trimmedDescription,
      },
      {
        onSuccess: (created) => {
          onClose()
          onCreated?.(created)
        },
        onError: handleError,
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar proyecto' : 'Nuevo proyecto'}
      description="Un proyecto agrupa blueprints. No toca ninguna base de datos."
      size="lg"
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(submit)(event)}>
        <div className="flex flex-col gap-1">
          <Input
            label="Nombre"
            required
            autoFocus
            maxLength={PROJECT_NAME_MAX}
            hint="Tiene que ser único: sirve para distinguir la iniciativa en cualquier selector."
            error={nameConflict ?? errors.name?.message}
            {...register('name')}
          />
          <span className="self-end text-xs text-muted-foreground">
            {name.length}/{PROJECT_NAME_MAX}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <Textarea
            label="Descripción"
            rows={4}
            maxLength={PROJECT_DESCRIPTION_MAX}
            error={errors.description?.message}
            {...register('description')}
          />
          <div className="flex items-center justify-between gap-3">
            {isEdit ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={description.trim() === ''}
                onClick={() => setValue('description', '', { shouldDirty: true })}
              >
                Vaciar la descripción
              </Button>
            ) : (
              <span />
            )}
            <span className="text-xs text-muted-foreground">
              {description.length}/{PROJECT_DESCRIPTION_MAX}
            </span>
          </div>
          {isEdit && (
            <p className="text-xs text-muted-foreground">
              Vaciar la descripción la borra. Dejar el campo en blanco guarda un texto vacío.
            </p>
          )}
        </div>

        {!isEdit && (
          <p className="rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
            Los blueprints se agregan después de crear el proyecto. Así, si algún blueprint ya no
            existe, el proyecto no queda a medio crear.
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {isEdit ? 'Guardar cambios' : 'Crear proyecto'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
