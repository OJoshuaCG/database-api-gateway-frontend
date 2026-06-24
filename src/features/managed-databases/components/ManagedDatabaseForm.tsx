import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  CHARSET_PATTERN,
  IDENTIFIER_PATTERN,
  type DatabaseModelOut,
  type ManagedDatabaseCreate,
  type ManagedDatabaseUpdate,
  type ServerOut,
  type ServerUserOut,
} from '@/lib/contracts'
import { Button, Combobox, Input, Switch, Textarea } from '@/components/ui'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import { useDatabaseModelOptions } from '@/features/database-models/hooks/use-database-model-options'

export interface ManagedDatabaseFormValues {
  name: string
  server_id: number
  owner_id: number
  model_id: number | null
  model_version: string
  charset: string
  collation: string
  notes: string
  provision: boolean
}

const DEFAULTS: ManagedDatabaseFormValues = {
  name: '',
  server_id: 0,
  owner_id: 0,
  model_id: null,
  model_version: '',
  charset: '',
  collation: '',
  notes: '',
  provision: false,
}

const optionalCharset = z.union([z.string().regex(CHARSET_PATTERN, 'Inválido'), z.literal('')])

function buildSchema(mode: 'create' | 'edit') {
  return z.object({
    name:
      mode === 'create'
        ? z.string().min(1, 'Requerido').regex(IDENTIFIER_PATTERN, 'Identificador inválido')
        : z.string(),
    server_id:
      mode === 'create' ? z.number().int().min(1, 'Selecciona un servidor') : z.number().int(),
    owner_id:
      mode === 'create' ? z.number().int().min(1, 'Selecciona un propietario') : z.number().int(),
    model_id: z.number().int().min(1).nullable(),
    model_version: z.string().max(50),
    charset: optionalCharset,
    collation: optionalCharset,
    notes: z.string(),
    provision: z.boolean(),
  })
}

export function toManagedDatabaseCreate(values: ManagedDatabaseFormValues): ManagedDatabaseCreate {
  return {
    name: values.name.trim(),
    server_id: values.server_id,
    owner_id: values.owner_id,
    model_id: values.model_id,
    model_version: values.model_version.trim() ? values.model_version.trim() : null,
    charset: values.charset.trim() ? values.charset.trim() : null,
    collation: values.collation.trim() ? values.collation.trim() : null,
    notes: values.notes.trim() ? values.notes.trim() : null,
  }
}

export function toManagedDatabaseUpdate(values: ManagedDatabaseFormValues): ManagedDatabaseUpdate {
  return {
    model_id: values.model_id,
    model_version: values.model_version.trim() ? values.model_version.trim() : null,
    charset: values.charset.trim() ? values.charset.trim() : null,
    collation: values.collation.trim() ? values.collation.trim() : null,
    notes: values.notes.trim() ? values.notes.trim() : null,
  }
}

interface ManagedDatabaseFormProps {
  mode: 'create' | 'edit'
  defaultValues?: Partial<ManagedDatabaseFormValues>
  readonlyIdentity?: { name: string; serverName?: string }
  isSubmitting?: boolean
  onSubmit: (values: ManagedDatabaseFormValues) => void
  onCancel: () => void
}

export function ManagedDatabaseForm({
  mode,
  defaultValues,
  readonlyIdentity,
  isSubmitting,
  onSubmit,
  onCancel,
}: ManagedDatabaseFormProps) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ManagedDatabaseFormValues>({
    resolver: zodResolver(buildSchema(mode)),
    defaultValues: { ...DEFAULTS, ...defaultValues },
  })

  const servers = useServerOptions()
  const selectedServerId = watch('server_id')
  const owners = useServerUserOptions(selectedServerId || null)
  const models = useDatabaseModelOptions()

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      {mode === 'create' ? (
        <>
          <Input
            label="Nombre de la BD"
            required
            error={errors.name?.message}
            {...register('name')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="server_id"
              render={({ field, fieldState }) => (
                <Combobox<ServerOut>
                  items={servers.data ?? []}
                  value={servers.data?.find((s) => s.id === field.value) ?? null}
                  onChange={(server) => {
                    field.onChange(server?.id ?? 0)
                    setValue('owner_id', 0) // el owner debe ser del mismo servidor
                  }}
                  itemToString={(s) => `${s.name} (${s.engine})`}
                  itemToKey={(s) => s.id}
                  label="Servidor"
                  required
                  isLoading={servers.isLoading}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="owner_id"
              render={({ field, fieldState }) => (
                <Combobox<ServerUserOut>
                  items={owners.data ?? []}
                  value={owners.data?.find((u) => u.id === field.value) ?? null}
                  onChange={(user) => field.onChange(user?.id ?? 0)}
                  itemToString={(u) => (u.host ? `${u.username}@${u.host}` : u.username)}
                  itemToKey={(u) => u.id}
                  label="Propietario"
                  required
                  disabled={!selectedServerId}
                  isLoading={owners.isFetching}
                  placeholder={
                    selectedServerId ? 'Selecciona un propietario' : 'Elige un servidor primero'
                  }
                  error={fieldState.error?.message}
                />
              )}
            />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm">
          <p className="font-medium text-foreground">{readonlyIdentity?.name}</p>
          {readonlyIdentity?.serverName && (
            <p className="text-muted-foreground">{readonlyIdentity.serverName}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Nombre, servidor y propietario no se editan aquí (usa «Reasignar propietario»).
          </p>
        </div>
      )}

      <Controller
        control={control}
        name="model_id"
        render={({ field }) => (
          <Combobox<DatabaseModelOut>
            items={models.data ?? []}
            value={models.data?.find((m) => m.id === field.value) ?? null}
            onChange={(model) => field.onChange(model?.id ?? null)}
            itemToString={(m) => `${m.name} (${m.current_version})`}
            itemToKey={(m) => m.id}
            label="Blueprint (opcional)"
            placeholder="Sin blueprint"
            isLoading={models.isLoading}
            clearable
          />
        )}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Versión del modelo"
          error={errors.model_version?.message}
          {...register('model_version')}
        />
        <Input
          label="Charset"
          hint="MySQL/MariaDB"
          error={errors.charset?.message}
          {...register('charset')}
        />
        <Input
          label="Collation"
          hint="MySQL/MariaDB"
          error={errors.collation?.message}
          {...register('collation')}
        />
      </div>

      <Textarea label="Notas" rows={2} {...register('notes')} />

      {mode === 'create' && (
        <Controller
          control={control}
          name="provision"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              label="Aprovisionar en el motor 🔌"
              hint="Ejecuta CREATE DATABASE y otorga privilegios al propietario."
            />
          )}
        />
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" isLoading={isSubmitting}>
          {mode === 'create' ? 'Crear base de datos' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}
