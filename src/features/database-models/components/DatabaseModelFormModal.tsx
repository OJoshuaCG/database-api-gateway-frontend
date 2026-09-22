import { useState } from 'react'
import { Modal } from '@/components/ui'
import { toApiError, type ApiError } from '@/lib/api/errors'
import type { DatabaseModelOut } from '@/lib/contracts'
import {
  useCreateDatabaseModel,
  useModelDatabases,
  useUpdateDatabaseModel,
} from '../hooks/use-database-models'
import {
  DatabaseModelForm,
  toDatabaseModelCreate,
  toDatabaseModelUpdate,
  type DatabaseModelFormValues,
} from './DatabaseModelForm'
import { RenameSlugDialog } from './RenameSlugDialog'

interface DatabaseModelFormModalProps {
  open: boolean
  onClose: () => void
  model?: DatabaseModelOut
}

/**
 * Alta y edición de un blueprint, y la puerta al asistente de renombrado de slug.
 *
 * El conteo de bases gestionadas se resuelve **acá** y no dentro del formulario: es quien conoce el
 * `model`, y el formulario se mantiene sin consultas propias para poder montarse en `create`, donde
 * todavía no hay id contra el que preguntar.
 *
 * El asistente se monta **fuera** del `<form>` y como hermano de este modal. Los dos son `<dialog>`
 * nativos y viven en el top layer, así que el segundo queda por encima sin anidar un formulario
 * dentro de otro.
 */
export function DatabaseModelFormModal({ open, onClose, model }: DatabaseModelFormModalProps) {
  const [renaming, setRenaming] = useState(false)
  const [submitError, setSubmitError] = useState<ApiError | null>(null)

  const create = useCreateDatabaseModel()
  const update = useUpdateDatabaseModel(model?.id ?? 0)
  const isSubmitting = create.isPending || update.isPending

  // Solo en edición y solo con el modal abierto: en `create` no hay blueprint contra el que
  // preguntar, y sin abrir no hay nada que decidir con la respuesta.
  const databases = useModelDatabases(model?.id ?? 0, open && model !== undefined)

  const handleSubmit = (values: DatabaseModelFormValues) => {
    // El rechazo anterior deja de describir lo que se manda ahora: se limpia antes de enviar, no
    // después, para que un fallo de red no deje el 409 viejo pegado a un campo que ya cambió.
    setSubmitError(null)
    const onError = (error: unknown) => setSubmitError(toApiError(error))
    if (model) {
      update.mutate(toDatabaseModelUpdate(values), { onSuccess: onClose, onError })
    } else {
      create.mutate(toDatabaseModelCreate(values), { onSuccess: onClose, onError })
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={model ? 'Editar blueprint' : 'Crear blueprint'}
        description="Categoría lógica reutilizable de bases de datos. No toca ningún motor."
        size="lg"
      >
        <DatabaseModelForm
          mode={model ? 'edit' : 'create'}
          // El conteo llega `undefined` mientras la consulta está en vuelo o si falló, y el
          // formulario lo interpreta como «puede haber bases»: el default seguro.
          managedDatabaseCount={model ? databases.data?.length : undefined}
          onRenameSlug={model ? () => setRenaming(true) : undefined}
          submitError={submitError}
          defaultValues={
            model
              ? {
                  name: model.name,
                  slug: model.slug,
                  description: model.description ?? '',
                  current_version: model.current_version,
                  is_active: model.is_active,
                  // `null` cuando el blueprint no lo declara: el selector se queda en "por
                  // defecto del motor" en vez de autopreseleccionar y declararlo sin querer.
                  charsetCollation: model.charset
                    ? { charset: model.charset, collation: model.collation ?? null }
                    : null,
                }
              : undefined
          }
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
          onCancel={onClose}
        />
      </Modal>

      {renaming && model && (
        <RenameSlugDialog
          modelId={model.id}
          currentSlug={model.slug}
          onClose={() => setRenaming(false)}
          onRenamed={() => {
            // Se cierra TODO, no solo el asistente. El formulario nació con el slug viejo en sus
            // `defaultValues` y `useForm` no los resincroniza: dejarlo abierto mostraría el slug
            // anterior como si siguiera siendo el del blueprint, y el siguiente «Guardar cambios»
            // intentaría volver a ponerlo. Llega al CERRAR el paso de resultado del asistente, no
            // con el 200: antes el operador tiene que ver qué pasó con el espejo en cada base.
            setRenaming(false)
            onClose()
          }}
        />
      )}
    </>
  )
}
