import { Controller, useForm, useWatch } from 'react-hook-form'
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
import { rebindFields, rebindMessage, type RebindBaseline } from '../server-rebind'

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

/**
 * En edición, `original` es el servidor guardado: si el formulario lo re-apunta (host, puerto,
 * motor o TLS más débil) la contraseña deja de ser opcional, con la misma regla que el backend
 * (ver `server-rebind.ts`). Se valida acá para no mandar un `PATCH` que ya se sabe rechazado.
 */
function buildSchema(mode: 'create' | 'edit', original?: RebindBaseline) {
  const base = z.object({
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
  if (mode !== 'edit' || !original) return base
  return base.superRefine((values, ctx) => {
    const fields = rebindFields(original, values)
    if (fields.length > 0 && values.root_password.trim().length === 0) {
      ctx.addIssue({ code: 'custom', path: ['root_password'], message: rebindMessage(fields) })
    }
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

/** Lo que el llamador puede hacer sobre el formulario cuando el backend rechaza el envío. */
export interface ServerFormHelpers {
  /**
   * Marca la contraseña como obligatoria con `message` y la enfoca: la salida del 422
   * `server.credential_required_for_rebind`, que es reingresarla y volver a guardar.
   */
  requirePassword: (message: string) => void
}

interface ServerFormProps {
  mode: 'create' | 'edit'
  defaultValues?: Partial<ServerFormValues>
  /** Solo en edición: el servidor guardado, para anticipar si el cambio exige la contraseña. */
  original?: RebindBaseline
  isSubmitting?: boolean
  onSubmit: (values: ServerFormValues, form: ServerFormHelpers) => void
  onCancel: () => void
}

export function ServerForm({
  mode,
  defaultValues,
  original,
  isSubmitting,
  onSubmit,
  onCancel,
}: ServerFormProps) {
  const {
    register,
    handleSubmit,
    control,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<ServerFormValues>({
    resolver: zodResolver(buildSchema(mode, original)),
    defaultValues: { ...DEFAULTS, ...defaultValues },
  })

  // Aviso EN VIVO, antes de enviar: en cuanto el cambio re-apunta el servidor, la contraseña pasa
  // a obligatoria con el porqué a la vista. El backend sigue siendo quien decide (422).
  // `useWatch` y no `watch`: el segundo no se puede memoizar y el React Compiler salta el componente.
  const [host, port, engine, sslMode] = useWatch({
    control,
    name: ['host', 'port', 'engine', 'ssl_mode'],
  })
  const pendingRebind =
    mode === 'edit' && original
      ? rebindFields(original, { host, port, engine, ssl_mode: sslMode })
      : []
  const passwordRequired = mode === 'create' || pendingRebind.length > 0

  const helpers: ServerFormHelpers = {
    requirePassword: (message) => {
      setError('root_password', { type: 'server', message })
      setFocus('root_password')
    },
  }

  return (
    <form
      onSubmit={handleSubmit((values) => onSubmit(values, helpers))}
      className="flex flex-col gap-4"
      noValidate
    >
      <Input label="Nombre" required error={errors.name?.message} {...register('name')} />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
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
        required={passwordRequired}
        hint={
          mode === 'create'
            ? 'Se cifra; nunca se devuelve.'
            : pendingRebind.length > 0
              ? rebindMessage(pendingRebind)
              : 'Déjalo en blanco para no cambiarla.'
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
