import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Combobox, Input, Modal } from '@/components/ui'
import { CapabilityHint, notifyMutationError, useCapabilityGuard, useStepUp } from '@/features/auth'
import { useEnvironmentOptions } from '@/features/environments'
import { toApiError } from '@/lib/api/errors'
import {
  CAPABILITIES,
  RELEASE_CHANNEL_ERROR_CODES,
  RELEASE_CHANNEL_MODES,
  RELEASE_CHANNEL_NAME_MAX,
  RELEASE_CHANNEL_SLUG_MAX,
  releaseChannelCreateSchema,
  type EnvironmentOut,
  type ReleaseChannelMode,
  type ReleaseChannelOut,
} from '@/lib/contracts'
import { useToast } from '@/lib/toast/use-toast'
import { useCreateReleaseChannel, useUpdateReleaseChannel } from '../hooks/use-release-channels'
import {
  releaseChannelMessage,
  releaseChannelModeDescription,
  releaseChannelModeLabel,
} from '../messages'

interface ReleaseChannelFormValues {
  name: string
  slug: string
  resolution_mode: ReleaseChannelMode
  environment_id: number | null
}

interface ReleaseChannelFormModalProps {
  open: boolean
  onClose: () => void
  /** Ausente = alta. Presente = edición. */
  channel?: ReleaseChannelOut
}

/**
 * Alta y edición de un canal de liberación.
 *
 * El slug se puede escribir solo al crear: es la identidad que citan las integraciones
 * (`?channel=stable`), y renombrarlo las rompería sin que nada falle. En edición queda visible y
 * deshabilitado para que se vea qué canal se está tocando.
 *
 * Los errores de campo del backend (nombre o slug repetido, entorno faltante) se muestran inline
 * junto al campo que se corrige; cualquier otro va a toast. Escribir un canal pide step-up.
 */
export function ReleaseChannelFormModal({ open, onClose, channel }: ReleaseChannelFormModalProps) {
  const isEdit = channel !== undefined
  const toast = useToast()
  const stepUp = useStepUp()
  const guard = useCapabilityGuard(
    CAPABILITIES.releaseChannelsWrite,
    isEdit ? 'editar el canal' : 'crear el canal',
  )
  const create = useCreateReleaseChannel()
  const update = useUpdateReleaseChannel(channel?.id ?? 0)
  const isSubmitting = create.isPending || update.isPending

  const environments = useEnvironmentOptions()
  // Un canal ya enlazado a un entorno que después se desactivó tiene que seguir mostrándolo, aunque
  // no se pueda elegir uno inactivo para enlazar de nuevo.
  const selectableEnvironments = (environments.data ?? []).filter(
    (environment) => environment.is_active || environment.id === channel?.environment_id,
  )

  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<ReleaseChannelFormValues>({
    resolver: zodResolver(releaseChannelCreateSchema),
    defaultValues: {
      name: channel?.name ?? '',
      slug: channel?.slug ?? '',
      resolution_mode: isReleaseChannelMode(channel?.resolution_mode)
        ? channel.resolution_mode
        : 'manual',
      environment_id: channel?.environment_id ?? null,
    },
  })

  const watchedMode = watch('resolution_mode')
  const modeDescription = releaseChannelModeDescription(watchedMode)

  const handleError = (error: unknown) => {
    const apiError = toApiError(error)
    const message = releaseChannelMessage(apiError.code)
    if (apiError.code === RELEASE_CHANNEL_ERROR_CODES.nameTaken && message) {
      setError('name', { message })
      setFocus('name')
      return
    }
    if (apiError.code === RELEASE_CHANNEL_ERROR_CODES.slugTaken && message) {
      setError('slug', { message })
      setFocus('slug')
      return
    }
    if (apiError.code === RELEASE_CHANNEL_ERROR_CODES.environmentRequired && message) {
      setError('environment_id', { message })
      return
    }
    notifyMutationError(
      toast,
      error,
      isEdit ? 'No se pudo actualizar el canal' : 'No se pudo crear el canal',
      message ?? apiError.message,
    )
  }

  const persist = (values: ReleaseChannelFormValues) => {
    if (isEdit) {
      // Sin `slug`: el PATCH no lo admite. `environment_id: null` es la orden explícita de
      // desvincular, por eso se manda siempre y no solo cuando cambia.
      update.mutate(
        {
          name: values.name.trim(),
          resolution_mode: values.resolution_mode,
          environment_id: values.environment_id,
        },
        { onSuccess: onClose, onError: handleError },
      )
      return
    }
    create.mutate(
      {
        name: values.name.trim(),
        slug: values.slug.trim().toLowerCase(),
        resolution_mode: values.resolution_mode,
        environment_id: values.environment_id,
      },
      { onSuccess: onClose, onError: handleError },
    )
  }

  const submit = (values: ReleaseChannelFormValues) => {
    stepUp.withFresh(CAPABILITIES.releaseChannelsWrite, () => persist(values))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar canal de liberación' : 'Nuevo canal de liberación'}
      description="Un canal decide qué versión de un blueprint consumen las integraciones. No toca ninguna base de datos."
      size="lg"
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(submit)(event)}>
        <Input
          label="Nombre"
          required
          autoFocus
          maxLength={RELEASE_CHANNEL_NAME_MAX}
          hint="Tiene que ser único."
          error={errors.name?.message}
          {...register('name')}
        />

        <Input
          label="Identificador (slug)"
          required
          maxLength={RELEASE_CHANNEL_SLUG_MAX}
          disabled={isEdit}
          hint={
            isEdit
              ? 'No se puede cambiar: las integraciones lo citan por este identificador.'
              : 'Minúsculas, dígitos y guiones. Es único y no se puede cambiar después.'
          }
          error={errors.slug?.message}
          {...register('slug')}
        />

        <Controller
          control={control}
          name="resolution_mode"
          render={({ field }) => (
            <Combobox<ReleaseChannelMode>
              items={[...RELEASE_CHANNEL_MODES]}
              value={field.value}
              onChange={(mode) => field.onChange(mode ?? 'manual')}
              itemToString={releaseChannelModeLabel}
              itemToKey={(mode) => mode}
              label="Modo de resolución"
              required
              hint={modeDescription ?? undefined}
            />
          )}
        />

        <Controller
          control={control}
          name="environment_id"
          render={({ field, fieldState }) => (
            <Combobox<EnvironmentOut>
              items={selectableEnvironments}
              value={selectableEnvironments.find((e) => e.id === field.value) ?? null}
              onChange={(environment) => field.onChange(environment?.id ?? null)}
              itemToString={(environment) => environment.name}
              itemToKey={(environment) => environment.id}
              label="Entorno enlazado"
              required={watchedMode === 'derived'}
              isLoading={environments.isLoading}
              placeholder="Sin entorno"
              clearable
              hint="Obligatorio en modo derivado. Mientras un canal lo use, el entorno no se puede borrar."
              error={fieldState.error?.message}
            />
          )}
        />

        <CapabilityHint guard={guard} />

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            type="submit"
            isLoading={isSubmitting}
            disabled={!guard.allowed}
            aria-describedby={guard.describedBy}
          >
            {isEdit ? 'Guardar cambios' : 'Crear canal'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** El backend lee el modo como `str`; el formulario solo puede editar los que conoce. */
function isReleaseChannelMode(value: string | undefined): value is ReleaseChannelMode {
  return value !== undefined && (RELEASE_CHANNEL_MODES as readonly string[]).includes(value)
}
