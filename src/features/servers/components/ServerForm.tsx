import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  engineTypeSchema,
  sslModeSchema,
  type EngineType,
  type ServerCreate,
  type ServerUpdate,
  type SslMode,
} from '@/lib/contracts'
import { Button, Checkbox, Combobox, Input, Textarea } from '@/components/ui'

interface Option<T> {
  value: T
  label: string
}

const ENGINE_OPTIONS: Option<EngineType>[] = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'postgresql', label: 'PostgreSQL' },
]

const SSL_OPTIONS: Option<SslMode | null>[] = [
  { value: null, label: 'Sin TLS' },
  ...sslModeSchema.options.map((mode) => ({ value: mode, label: mode })),
]

export interface ServerFormValues {
  name: string
  host: string
  port: number
  engine: EngineType
  root_username: string
  root_password: string
  ssl_mode: SslMode | null
  notes: string
  is_active: boolean
}

const DEFAULTS: ServerFormValues = {
  name: '',
  host: '',
  port: 3306,
  engine: 'mysql',
  root_username: '',
  root_password: '',
  ssl_mode: null,
  notes: '',
  is_active: true,
}

function buildSchema(mode: 'create' | 'edit') {
  return z.object({
    name: z.string().min(1, 'Requerido').max(100),
    host: z.string().min(1, 'Requerido').max(255),
    port: z.number({ message: 'Puerto inválido' }).int().min(1, '1–65535').max(65535, '1–65535'),
    engine: engineTypeSchema,
    root_username: z.string().min(1, 'Requerido').max(128),
    root_password: mode === 'create' ? z.string().min(1, 'Requerido') : z.string(), // en edición, vacío = no cambiar
    ssl_mode: sslModeSchema.nullable(),
    notes: z.string(),
    is_active: z.boolean(),
  })
}

/** Convierte los valores del formulario en payload de creación. */
export function toServerCreate(values: ServerFormValues): ServerCreate {
  return {
    name: values.name.trim(),
    host: values.host.trim(),
    port: values.port,
    engine: values.engine,
    root_username: values.root_username.trim(),
    root_password: values.root_password,
    ssl_mode: values.ssl_mode,
    notes: values.notes.trim() ? values.notes.trim() : null,
    is_active: values.is_active,
  }
}

/** Convierte los valores en payload de actualización (omite el password si está vacío). */
export function toServerUpdate(values: ServerFormValues): ServerUpdate {
  const payload: ServerUpdate = {
    name: values.name.trim(),
    host: values.host.trim(),
    port: values.port,
    engine: values.engine,
    root_username: values.root_username.trim(),
    ssl_mode: values.ssl_mode,
    notes: values.notes.trim() ? values.notes.trim() : null,
    is_active: values.is_active,
  }
  if (values.root_password.trim().length > 0) payload.root_password = values.root_password
  return payload
}

interface ServerFormProps {
  mode: 'create' | 'edit'
  defaultValues?: Partial<ServerFormValues>
  isSubmitting?: boolean
  onSubmit: (values: ServerFormValues) => void
  onCancel: () => void
}

export function ServerForm({
  mode,
  defaultValues,
  isSubmitting,
  onSubmit,
  onCancel,
}: ServerFormProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ServerFormValues>({
    resolver: zodResolver(buildSchema(mode)),
    defaultValues: { ...DEFAULTS, ...defaultValues },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <Input label="Nombre" required error={errors.name?.message} {...register('name')} />
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Input
          label="Host"
          required
          hint="No se permiten hosts privados/loopback (anti-SSRF)."
          error={errors.host?.message}
          {...register('host')}
        />
        <Input
          label="Puerto"
          type="number"
          required
          error={errors.port?.message}
          {...register('port', { valueAsNumber: true })}
        />
      </div>

      <Controller
        control={control}
        name="engine"
        render={({ field, fieldState }) => (
          <Combobox<Option<EngineType>>
            items={ENGINE_OPTIONS}
            value={ENGINE_OPTIONS.find((o) => o.value === field.value) ?? null}
            onChange={(option) => option && field.onChange(option.value)}
            itemToString={(o) => o.label}
            itemToKey={(o) => o.value}
            label="Motor"
            required
            error={fieldState.error?.message}
          />
        )}
      />

      <Input
        label="Usuario root (pseudo-root)"
        required
        autoComplete="off"
        error={errors.root_username?.message}
        {...register('root_username')}
      />
      <Input
        label="Contraseña root"
        type="password"
        autoComplete="new-password"
        required={mode === 'create'}
        hint={
          mode === 'edit' ? 'Déjalo en blanco para no cambiarla.' : 'Se cifra; nunca se devuelve.'
        }
        error={errors.root_password?.message}
        {...register('root_password')}
      />

      <Controller
        control={control}
        name="ssl_mode"
        render={({ field }) => (
          <Combobox<Option<SslMode | null>>
            items={SSL_OPTIONS}
            value={SSL_OPTIONS.find((o) => o.value === field.value) ?? SSL_OPTIONS[0]!}
            onChange={(option) => field.onChange(option ? option.value : null)}
            itemToString={(o) => o.label}
            itemToKey={(o) => o.value ?? 'none'}
            label="Modo TLS"
          />
        )}
      />

      <Textarea label="Notas" rows={2} {...register('notes')} />

      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <Checkbox
            label="Servidor activo"
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
          {mode === 'create' ? 'Registrar servidor' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}
