import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { SLUG_PATTERN, type DatabaseModelCreate, type DatabaseModelUpdate } from '@/lib/contracts'
import { Button, Checkbox, Input, Textarea } from '@/components/ui'
import {
  CharsetCollationSelector,
  type CharsetCollationValue,
} from '@/features/charset-collation-options'

export interface DatabaseModelFormValues {
  name: string
  slug: string
  description: string
  current_version: string
  is_active: boolean
  /** Juego de caracteres de REFERENCIA del esquema (api-reference-v11 §2). */
  charsetCollation: CharsetCollationValue | null | undefined
}

const DEFAULTS: DatabaseModelFormValues = {
  name: '',
  slug: '',
  description: '',
  current_version: '0.0.0',
  is_active: true,
  // `null` explícito, no `undefined`: `undefined` haría que el selector se autopreseleccione
  // con el default del catálogo, y declarar un collation debe ser una decisión, no un descuido.
  charsetCollation: null,
}

const schema = z.object({
  name: z.string().min(1, 'Requerido').max(100),
  slug: z.string().min(1, 'Requerido').max(120).regex(SLUG_PATTERN, 'kebab/snake en minúsculas'),
  description: z.string(),
  current_version: z.string().max(50),
  is_active: z.boolean(),
  // Sin validación propia: el selector solo produce combinaciones válidas del catálogo.
  charsetCollation: z.custom<CharsetCollationValue | null | undefined>(),
})

export function toDatabaseModelCreate(values: DatabaseModelFormValues): DatabaseModelCreate {
  return {
    name: values.name.trim(),
    slug: values.slug.trim(),
    description: values.description.trim() ? values.description.trim() : null,
    current_version: values.current_version.trim() || '0.0.0',
    is_active: values.is_active,
    charset: values.charsetCollation ? values.charsetCollation.charset : null,
    collation: values.charsetCollation ? values.charsetCollation.collation : null,
  }
}

export function toDatabaseModelUpdate(values: DatabaseModelFormValues): DatabaseModelUpdate {
  return {
    name: values.name.trim(),
    slug: values.slug.trim(),
    description: values.description.trim() ? values.description.trim() : null,
    current_version: values.current_version.trim() || '0.0.0',
    is_active: values.is_active,
    charset: values.charsetCollation ? values.charsetCollation.charset : null,
    collation: values.charsetCollation ? values.charsetCollation.collation : null,
  }
}

interface DatabaseModelFormProps {
  mode: 'create' | 'edit'
  defaultValues?: Partial<DatabaseModelFormValues>
  isSubmitting?: boolean
  onSubmit: (values: DatabaseModelFormValues) => void
  onCancel: () => void
}

export function DatabaseModelForm({
  mode,
  defaultValues,
  isSubmitting,
  onSubmit,
  onCancel,
}: DatabaseModelFormProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<DatabaseModelFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...DEFAULTS, ...defaultValues },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nombre" required error={errors.name?.message} {...register('name')} />
        <Input
          label="Slug"
          required
          hint="kebab/snake en minúsculas (ej. whatsapp)"
          error={errors.slug?.message}
          {...register('slug')}
        />
      </div>
      <Input
        label="Versión actual"
        hint="SemVer, p. ej. 1.2.0"
        error={errors.current_version?.message}
        {...register('current_version')}
      />
      {/* Un blueprint no está atado a un motor, así que se fija la familia MySQL: es la
          semántica de estos dos campos. PostgreSQL usa `encoding` + `lc_collate`, que no son
          equivalentes, y contra esos destinos la comprobación de deriva no corre. */}
      <Controller
        control={control}
        name="charsetCollation"
        render={({ field }) => (
          <CharsetCollationSelector
            engineFamily="mysql"
            value={field.value}
            onChange={field.onChange}
            label="Charset / collation de referencia"
            hint="Opcional. Si lo declaras, el validador avisa cuando una migración fuerza un COLLATE distinto y podrás detectar BDs desviadas. Semántica MySQL/MariaDB."
          />
        )}
      />
      <Textarea label="Descripción" rows={3} {...register('description')} />
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <Checkbox
            label="Blueprint activo"
            checked={field.value}
            onChange={(event) => field.onChange(event.target.checked)}
          />
        )}
      />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" isLoading={isSubmitting}>
          {mode === 'create' ? 'Crear blueprint' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}
