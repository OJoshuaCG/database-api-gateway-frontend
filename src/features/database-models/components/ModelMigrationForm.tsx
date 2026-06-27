import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { MIGRATION_VERSION_PATTERN } from '@/lib/contracts'
import type { ModelMigrationCreate, ModelMigrationPatch } from '@/lib/contracts'
import { Button, Input, Textarea } from '@/components/ui'

const SQL_MAX = 262144

export interface ModelMigrationFormValues {
  version: string
  name: string
  up_sql: string
  up_sql_mysql: string
  up_sql_postgresql: string
  down_sql: string
}

const DEFAULTS: ModelMigrationFormValues = {
  version: '',
  name: '',
  up_sql: '',
  up_sql_mysql: '',
  up_sql_postgresql: '',
  down_sql: '',
}

function buildSchema(mode: 'create' | 'edit') {
  return z.object({
    version:
      mode === 'create'
        ? z.string().regex(MIGRATION_VERSION_PATTERN, 'Solo dígitos, 4–10 (ej. 0001)')
        : z.string(),
    name: z.string().min(1, 'Requerido').max(200, 'Máximo 200 caracteres'),
    up_sql:
      mode === 'create'
        ? z.string().min(1, 'Requerido').max(SQL_MAX, 'Máximo 256 KB')
        : z.string(),
    up_sql_mysql: z.string().max(SQL_MAX, 'Máximo 256 KB'),
    up_sql_postgresql: z.string().max(SQL_MAX, 'Máximo 256 KB'),
    down_sql: z.string().max(SQL_MAX, 'Máximo 256 KB'),
  })
}

const orNull = (value: string) => (value.trim() ? value : null)

export function toCreate(values: ModelMigrationFormValues): ModelMigrationCreate {
  return {
    version: values.version.trim(),
    name: values.name.trim(),
    up_sql: values.up_sql,
    up_sql_mysql: orNull(values.up_sql_mysql),
    up_sql_postgresql: orNull(values.up_sql_postgresql),
    down_sql: orNull(values.down_sql),
  }
}

export function toPatch(values: ModelMigrationFormValues): ModelMigrationPatch {
  return {
    name: values.name.trim(),
    down_sql: orNull(values.down_sql),
    up_sql_mysql: orNull(values.up_sql_mysql),
    up_sql_postgresql: orNull(values.up_sql_postgresql),
  }
}

const monospace = 'font-mono text-xs'

interface ModelMigrationFormProps {
  mode: 'create' | 'edit'
  defaultValues?: Partial<ModelMigrationFormValues>
  isSubmitting?: boolean
  onSubmit: (values: ModelMigrationFormValues) => void
  onCancel: () => void
}

export function ModelMigrationForm({
  mode,
  defaultValues,
  isSubmitting,
  onSubmit,
  onCancel,
}: ModelMigrationFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ModelMigrationFormValues>({
    resolver: zodResolver(buildSchema(mode)),
    defaultValues: { ...DEFAULTS, ...defaultValues },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Versión"
          required={mode === 'create'}
          readOnly={mode === 'edit'}
          hint={mode === 'create' ? 'Solo dígitos; mantén ancho consistente (0001, 0002…).' : 'Inmutable.'}
          error={errors.version?.message}
          {...register('version')}
        />
        <Input label="Nombre" required error={errors.name?.message} {...register('name')} />
      </div>

      <Textarea
        label="up_sql (delta base, estilo MySQL)"
        required={mode === 'create'}
        readOnly={mode === 'edit'}
        rows={6}
        className={monospace}
        hint={
          mode === 'edit'
            ? 'El SQL base no se edita tras crearse (se traduce automáticamente).'
            : 'Se auto-traduce a PostgreSQL con sqlglot.'
        }
        error={errors.up_sql?.message}
        {...register('up_sql')}
      />

      <Textarea
        label="down_sql (rollback confirmado)"
        rows={4}
        className={monospace}
        hint="Sin él, el rollback responde 409. Revisa el sugerido y confírmalo aquí."
        error={errors.down_sql?.message}
        {...register('down_sql')}
      />

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Overrides manuales por motor (opcional)
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <Textarea
            label="up_sql_mysql (override MySQL/MariaDB)"
            rows={4}
            className={monospace}
            error={errors.up_sql_mysql?.message}
            {...register('up_sql_mysql')}
          />
          <Textarea
            label="up_sql_postgresql (override PostgreSQL)"
            rows={4}
            className={monospace}
            hint="Útil para ENUM inline, ON UPDATE CURRENT_TIMESTAMP, UNSIGNED, rutinas BEGIN…END."
            error={errors.up_sql_postgresql?.message}
            {...register('up_sql_postgresql')}
          />
        </div>
      </details>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" isLoading={isSubmitting}>
          {mode === 'create' ? 'Crear migración' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}
