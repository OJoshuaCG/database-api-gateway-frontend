import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Button, Checkbox, Input, Modal, RadioCardGroup, Switch } from '@/components/ui'
import { toApiError, type CharsetDuplicateContext } from '@/lib/api/errors'
import type { CharsetCollationOptionCreate, EngineFamily } from '@/lib/contracts'
import {
  useCreateCharsetCollationOption,
  useUpdateCharsetCollationOption,
} from '../hooks/use-charset-collation-options'

export interface AddCharsetCollationOptionModalProps {
  open: boolean
  onClose: () => void
}

interface FormValues {
  engine_family: EngineFamily
  charset: string
  collation: string
  noSpecificCollation: boolean
  enabled: boolean
}

const DEFAULT_VALUES: FormValues = {
  engine_family: 'mysql',
  charset: '',
  collation: '',
  noSpecificCollation: false,
  enabled: true,
}

/** Etiquetas de campo según familia: mismo criterio que los formularios de creación de BD. */
const FIELD_LABELS: Record<EngineFamily, { charset: string; collation: string }> = {
  mysql: { charset: 'Character set', collation: 'Collation' },
  postgresql: { charset: 'Encoding', collation: 'Locale' },
}

const DISABLED_HINT =
  'Se agregará deshabilitada y no aparecerá en el selector de creación hasta que la habilites.'

/** Infiere a qué campo pertenece un mensaje 422 de nombre inválido (no es exhaustivo). */
function inferInvalidField(message: string): 'charset' | 'collation' | null {
  const lower = message.toLowerCase()
  if (lower.includes('collation') || lower.includes('locale')) return 'collation'
  if (lower.includes('charset') || lower.includes('encoding')) return 'charset'
  return null
}

/**
 * Alta de una combinación en el catálogo global de charset/collation. El backend valida la forma
 * exacta de `charset`/`collation` (422 con `public_context.pattern`), así que aquí no se duplica
 * ese patrón — solo se exige que `charset` no esté vacío.
 */
export function AddCharsetCollationOptionModal({
  open,
  onClose,
}: AddCharsetCollationOptionModalProps) {
  const create = useCreateCharsetCollationOption()
  const update = useUpdateCharsetCollationOption()
  const [duplicate, setDuplicate] = useState<CharsetDuplicateContext | null>(null)

  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setError,
    watch,
  } = useForm<FormValues>({ defaultValues: DEFAULT_VALUES })

  const engineFamily = watch('engine_family')
  const noSpecificCollation = watch('noSpecificCollation')
  const enabled = watch('enabled')
  const labels = FIELD_LABELS[engineFamily]
  const isPending = create.isPending || update.isPending

  const handleClose = () => {
    reset(DEFAULT_VALUES)
    setDuplicate(null)
    onClose()
  }

  const submit = (values: FormValues) => {
    setDuplicate(null)
    const body: CharsetCollationOptionCreate = {
      engine_family: values.engine_family,
      charset: values.charset.trim(),
      collation:
        values.noSpecificCollation || values.collation.trim().length === 0
          ? null
          : values.collation.trim(),
      enabled: values.enabled,
    }
    create.mutate(body, {
      onSuccess: handleClose,
      onError: (err) => {
        const apiError = toApiError(err)
        if (apiError.status === 409 && apiError.charsetDuplicate) {
          setDuplicate(apiError.charsetDuplicate)
          return
        }
        if (apiError.status === 422) {
          const field = inferInvalidField(apiError.message)
          if (field) {
            setError(field, { message: apiError.message })
          } else {
            setError('root', { message: apiError.message })
          }
        }
      },
    })
  }

  const enableDuplicateNow = () => {
    if (!duplicate) return
    update.mutate(
      { id: duplicate.id, body: { enabled: true } },
      { onSuccess: handleClose },
    )
  }

  return (
    <Modal
      open={open}
      onClose={isPending ? () => undefined : handleClose}
      title="Agregar combinación al catálogo"
      description="Define una combinación de charset/collation disponible al crear bases de datos nuevas."
      size="md"
    >
      <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-5" noValidate>
        <Controller
          control={control}
          name="engine_family"
          render={({ field }) => (
            <RadioCardGroup
              title="Familia de motor"
              options={[
                {
                  value: 'mysql',
                  label: 'MySQL / MariaDB',
                  hint: 'MySQL y MariaDB comparten catálogo.',
                  disabled: isPending,
                },
                { value: 'postgresql', label: 'PostgreSQL', disabled: isPending },
              ]}
              value={field.value}
              onChange={field.onChange}
              name="engine-family"
            />
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={labels.charset}
            required
            autoComplete="off"
            spellCheck={false}
            disabled={isPending}
            error={errors.charset?.message}
            {...register('charset', { required: 'Requerido.' })}
          />
          <div className="flex flex-col gap-2">
            <Input
              label={labels.collation}
              autoComplete="off"
              spellCheck={false}
              disabled={isPending || noSpecificCollation}
              error={errors.collation?.message}
              {...register('collation')}
            />
            <Controller
              control={control}
              name="noSpecificCollation"
              render={({ field }) => (
                <Checkbox
                  label="Sin collation específica (la elige el motor)"
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                  disabled={isPending}
                />
              )}
            />
          </div>
        </div>

        <Controller
          control={control}
          name="enabled"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              label="Habilitar de inmediato"
              hint={enabled ? undefined : DISABLED_HINT}
              disabled={isPending}
            />
          )}
        />

        <p className="text-xs text-muted-foreground">
          Para que sea la sugerida por defecto, marcala después desde el listado.
        </p>

        {duplicate && (
          <div className="flex flex-col gap-2 rounded-card border border-warning/30 bg-warning/5 p-3 text-xs">
            <p className="text-foreground">
              Esa combinación ya está en el catálogo, pero está{' '}
              {duplicate.enabled ? 'habilitada' : 'deshabilitada'}.
            </p>
            {!duplicate.enabled && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  isLoading={update.isPending}
                  onClick={enableDuplicateNow}
                >
                  Habilitarla ahora
                </Button>
              </div>
            )}
          </div>
        )}

        {errors.root?.message && <p className="text-xs text-error">{errors.root.message}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={create.isPending}>
            Agregar combinación
          </Button>
        </div>
      </form>
    </Modal>
  )
}
