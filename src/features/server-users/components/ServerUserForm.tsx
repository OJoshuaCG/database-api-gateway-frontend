import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  HOST_PATTERN,
  IDENTIFIER_PATTERN,
  type ServerOut,
  type ServerUserCreate,
  type ServerUserUpdate,
} from '@/lib/contracts'
import { Button, Checkbox, Combobox, Input, Switch, Textarea } from '@/components/ui'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'

export interface ServerUserFormValues {
  server_id: number
  username: string
  host: string
  password: string
  notes: string
  is_active: boolean
  provision: boolean
}

const DEFAULTS: ServerUserFormValues = {
  server_id: 0,
  username: '',
  host: '%',
  password: '',
  notes: '',
  is_active: true,
  provision: false,
}

function buildSchema(mode: 'create' | 'edit') {
  const base = z.object({
    server_id:
      mode === 'create' ? z.number().int().min(1, 'Selecciona un servidor') : z.number().int(),
    username:
      mode === 'create'
        ? z.string().min(1, 'Requerido').regex(IDENTIFIER_PATTERN, 'Identificador inválido')
        : z.string(),
    host:
      mode === 'create'
        ? z.union([z.string().regex(HOST_PATTERN, 'Host inválido'), z.literal('')])
        : z.string(),
    password: z.string(),
    notes: z.string(),
    is_active: z.boolean(),
    provision: z.boolean(),
  })
  return base.superRefine((values, ctx) => {
    if (values.provision && values.password.trim().length === 0) {
      ctx.addIssue({
        path: ['password'],
        code: 'custom',
        message: 'La contraseña es obligatoria para aprovisionar en el motor.',
      })
    }
  })
}

export function toServerUserCreate(values: ServerUserFormValues): ServerUserCreate {
  return {
    server_id: values.server_id,
    username: values.username.trim(),
    host: values.host.trim() ? values.host.trim() : '%',
    password: values.password.trim() ? values.password : null,
    notes: values.notes.trim() ? values.notes.trim() : null,
    is_active: values.is_active,
  }
}

export function toServerUserUpdate(values: ServerUserFormValues): ServerUserUpdate {
  const payload: ServerUserUpdate = {
    is_active: values.is_active,
    notes: values.notes.trim() ? values.notes.trim() : null,
  }
  if (values.password.trim().length > 0) payload.password = values.password
  return payload
}

interface ServerUserFormProps {
  mode: 'create' | 'edit'
  defaultValues?: Partial<ServerUserFormValues>
  /** En edición se muestran como solo lectura. */
  readonlyIdentity?: { username: string; host: string | null; serverName?: string }
  isSubmitting?: boolean
  onSubmit: (values: ServerUserFormValues) => void
  onCancel: () => void
}

export function ServerUserForm({
  mode,
  defaultValues,
  readonlyIdentity,
  isSubmitting,
  onSubmit,
  onCancel,
}: ServerUserFormProps) {
  const servers = useServerOptions()
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<ServerUserFormValues>({
    resolver: zodResolver(buildSchema(mode)),
    defaultValues: { ...DEFAULTS, ...defaultValues },
  })

  const provision = watch('provision')

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      {mode === 'create' ? (
        <>
          <Controller
            control={control}
            name="server_id"
            render={({ field, fieldState }) => (
              <Combobox<ServerOut>
                items={servers.data ?? []}
                value={servers.data?.find((s) => s.id === field.value) ?? null}
                onChange={(server) => field.onChange(server?.id ?? 0)}
                itemToString={(s) => `${s.name} (${s.engine})`}
                itemToKey={(s) => s.id}
                label="Servidor"
                required
                isLoading={servers.isLoading}
                error={fieldState.error?.message}
              />
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Usuario"
              required
              error={errors.username?.message}
              {...register('username')}
            />
            <Input
              label="Host"
              hint="Solo MySQL/MariaDB; «%» = cualquier host."
              error={errors.host?.message}
              {...register('host')}
            />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm">
          <p className="font-medium text-foreground">
            {readonlyIdentity?.username}
            {readonlyIdentity?.host ? `@${readonlyIdentity.host}` : ''}
          </p>
          {readonlyIdentity?.serverName && (
            <p className="text-muted-foreground">{readonlyIdentity.serverName}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Usuario, host y servidor son inmutables.
          </p>
        </div>
      )}

      <Input
        label="Contraseña"
        type="password"
        autoComplete="new-password"
        required={provision}
        hint={
          mode === 'edit'
            ? 'Déjala en blanco para no cambiarla. Con aprovisionar, ejecuta ALTER USER.'
            : 'Obligatoria si aprovisionas en el motor.'
        }
        error={errors.password?.message}
        {...register('password')}
      />

      <Controller
        control={control}
        name="provision"
        render={({ field }) => (
          <Switch
            checked={field.value}
            onCheckedChange={field.onChange}
            label="Aprovisionar en el motor 🔌"
            hint={
              mode === 'create'
                ? 'Ejecuta CREATE USER en el servidor destino.'
                : 'Ejecuta ALTER USER si cambias la contraseña.'
            }
          />
        )}
      />

      <Textarea label="Notas" rows={2} {...register('notes')} />

      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <Checkbox
            label="Usuario activo"
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
          {mode === 'create' ? 'Crear usuario' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}
