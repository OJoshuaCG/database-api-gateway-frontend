import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  engineTypeSchema,
  grantLevelSchema,
  type EngineType,
  type GrantLevel,
  type PermissionProfileCreate,
  type PermissionProfileUpdate,
} from '@/lib/contracts'
import { Button, Checkbox, Combobox, Input, Switch, Textarea } from '@/components/ui'
import { PrivilegeMultiSelect, grantLevelsForEngine } from '@/features/privileges'

interface EngineOption {
  value: EngineType
  label: string
}

const ENGINE_OPTIONS: EngineOption[] = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'postgresql', label: 'PostgreSQL' },
]

export interface PermissionProfileFormValues {
  name: string
  engine: EngineType
  description: string
  is_active: boolean
  items: { level: GrantLevel; privileges: string[] }[]
}

const DEFAULTS: PermissionProfileFormValues = {
  name: '',
  engine: 'mysql',
  description: '',
  is_active: true,
  items: [{ level: 'database', privileges: [] }],
}

const schema = z.object({
  name: z.string().min(1, 'Requerido').max(100, 'Máximo 100 caracteres'),
  engine: engineTypeSchema,
  description: z.string(),
  is_active: z.boolean(),
  items: z
    .array(
      z.object({
        level: grantLevelSchema,
        privileges: z.array(z.string()).min(1, 'Selecciona al menos un privilegio'),
      }),
    )
    .min(1, 'Añade al menos un item'),
})

export function toCreate(values: PermissionProfileFormValues): PermissionProfileCreate {
  return {
    name: values.name.trim(),
    engine: values.engine,
    description: values.description.trim() ? values.description.trim() : null,
    items: values.items,
  }
}

export function toUpdate(values: PermissionProfileFormValues): PermissionProfileUpdate {
  // `engine` es inmutable; al enviar `items` reemplazan los anteriores (§11).
  return {
    name: values.name.trim(),
    description: values.description.trim() ? values.description.trim() : null,
    is_active: values.is_active,
    items: values.items,
  }
}

interface PermissionProfileFormProps {
  mode: 'create' | 'edit'
  defaultValues?: Partial<PermissionProfileFormValues>
  isSubmitting?: boolean
  onSubmit: (values: PermissionProfileFormValues) => void
  onCancel: () => void
}

export function PermissionProfileForm({
  mode,
  defaultValues,
  isSubmitting,
  onSubmit,
  onCancel,
}: PermissionProfileFormProps) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<PermissionProfileFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...DEFAULTS, ...defaultValues },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const engine = watch('engine')
  const levelOptions = grantLevelsForEngine(engine)

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <Input label="Nombre" required error={errors.name?.message} {...register('name')} />

      {mode === 'create' ? (
        <Controller
          control={control}
          name="engine"
          render={({ field, fieldState }) => (
            <Combobox<EngineOption>
              items={ENGINE_OPTIONS}
              value={ENGINE_OPTIONS.find((option) => option.value === field.value) ?? null}
              onChange={(option) => field.onChange(option?.value ?? 'mysql')}
              itemToString={(option) => option.label}
              itemToKey={(option) => option.value}
              label="Motor"
              required
              error={fieldState.error?.message}
            />
          )}
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm">
          <p className="font-medium text-foreground">
            Motor: {ENGINE_OPTIONS.find((option) => option.value === engine)?.label ?? engine}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">El motor es inmutable.</p>
        </div>
      )}

      <Textarea label="Descripción" rows={2} {...register('description')} />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Items del perfil</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ level: 'database', privileges: [] })}
          >
            Añadir item
          </Button>
        </div>
        {errors.items?.root && <p className="text-xs text-error">{errors.items.root.message}</p>}

        {fields.map((fieldItem, index) => (
          <div key={fieldItem.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="w-full sm:max-w-xs">
                <Controller
                  control={control}
                  name={`items.${index}.level`}
                  render={({ field }) => (
                    <Combobox
                      items={levelOptions}
                      value={levelOptions.find((option) => option.value === field.value) ?? null}
                      onChange={(option) => field.onChange(option?.value ?? 'database')}
                      itemToString={(option) => option.label}
                      itemToKey={(option) => option.value}
                      label="Nivel"
                    />
                  )}
                />
              </div>
              {fields.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-7"
                  onClick={() => remove(index)}
                >
                  Quitar
                </Button>
              )}
            </div>
            <Controller
              control={control}
              name={`items.${index}.privileges`}
              render={({ field, fieldState }) => (
                <div className="flex flex-col gap-1">
                  <PrivilegeMultiSelect
                    engine={engine}
                    value={field.value}
                    onChange={field.onChange}
                  />
                  {fieldState.error?.message && (
                    <p className="text-xs text-error">{fieldState.error.message}</p>
                  )}
                </div>
              )}
            />
          </div>
        ))}
      </div>

      {mode === 'edit' && (
        <Controller
          control={control}
          name="is_active"
          render={({ field }) => (
            <Switch checked={field.value} onCheckedChange={field.onChange} label="Perfil activo" />
          )}
        />
      )}

      {mode === 'create' && (
        <Controller
          control={control}
          name="is_active"
          render={({ field }) => (
            <Checkbox
              label="Perfil activo"
              checked={field.value}
              onChange={(event) => field.onChange(event.target.checked)}
            />
          )}
        />
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" isLoading={isSubmitting}>
          {mode === 'create' ? 'Crear perfil' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}
