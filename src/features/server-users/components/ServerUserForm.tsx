import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  HOST_PATTERN,
  IDENTIFIER_PATTERN,
  type EngineType,
  type GrantLevel,
  type GrantRequest,
  type ObjectRef,
  type ServerOut,
  type ServerUserCreate,
  type ServerUserUpdate,
} from '@/lib/contracts'
import { Button, Checkbox, Combobox, Input, Switch, Textarea } from '@/components/ui'
import { PrivilegeMultiSelect, grantLevelsForEngine } from '@/features/privileges'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import {
  LEVELS_WITH_DATABASE,
  LEVELS_WITH_SCHEMA,
  LEVELS_WITH_TABLE,
  ROUTINE_KINDS,
} from './grant-object-levels'

export interface ServerUserFormValues {
  server_id: number
  username: string
  host: string
  password: string
  notes: string
  is_active: boolean
  provision: boolean
  /** Sección opcional «Permisos iniciales» (solo create + provision): un grant vía `/provision`. */
  grant_enabled: boolean
  grant_level: GrantLevel
  grant_database: string
  grant_schema: string
  grant_table: string
  grant_columns: string
  grant_sequence: string
  grant_routine_kind: 'FUNCTION' | 'PROCEDURE'
  grant_routine_name: string
  grant_privileges: string[]
  grant_with_grant_option: boolean
}

const DEFAULTS: ServerUserFormValues = {
  server_id: 0,
  username: '',
  host: '%',
  password: '',
  notes: '',
  is_active: true,
  provision: false,
  grant_enabled: false,
  grant_level: 'database',
  grant_database: '',
  grant_schema: 'public',
  grant_table: '',
  grant_columns: '',
  grant_sequence: '',
  grant_routine_kind: 'FUNCTION',
  grant_routine_name: '',
  grant_privileges: [],
  grant_with_grant_option: false,
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
    grant_enabled: z.boolean(),
    grant_level: z.enum(['global', 'database', 'schema', 'table', 'column', 'sequence', 'routine']),
    grant_database: z.string(),
    grant_schema: z.string(),
    grant_table: z.string(),
    grant_columns: z.string(),
    grant_sequence: z.string(),
    grant_routine_kind: z.enum(['FUNCTION', 'PROCEDURE']),
    grant_routine_name: z.string(),
    grant_privileges: z.array(z.string()),
    grant_with_grant_option: z.boolean(),
  })
  return base.superRefine((values, ctx) => {
    if (values.provision && values.password.trim().length === 0) {
      ctx.addIssue({
        path: ['password'],
        code: 'custom',
        message: 'La contraseña es obligatoria para aprovisionar en el motor.',
      })
    }
    if (values.provision && values.grant_enabled && values.grant_privileges.length === 0) {
      ctx.addIssue({
        path: ['grant_privileges'],
        code: 'custom',
        message: 'Selecciona al menos un privilegio (o desactiva los permisos iniciales).',
      })
    }
  })
}

export function toServerUserCreate(
  values: ServerUserFormValues,
  engine: EngineType | null,
): ServerUserCreate {
  return {
    server_id: values.server_id,
    username: values.username.trim(),
    // PostgreSQL no tiene hosts (rol global): el campo se omite en vez de mandar '%'.
    host: engine === 'postgresql' ? undefined : values.host.trim() ? values.host.trim() : '%',
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

/**
 * Grant inicial opcional para `POST /server-users/provision`. Mismo mapeo nivel→objeto que
 * `GrantManager.buildObjectRef`; devuelve `null` si la sección está apagada o sin privilegios.
 */
export function toInitialGrant(
  values: ServerUserFormValues,
  engine: EngineType | null,
): GrantRequest | null {
  if (!values.grant_enabled || values.grant_privileges.length === 0) return null
  const isPg = engine === 'postgresql'
  const level = values.grant_level
  const ref: ObjectRef = {}
  if (LEVELS_WITH_DATABASE.includes(level) && values.grant_database.trim())
    ref.database = values.grant_database.trim()
  if (isPg && LEVELS_WITH_SCHEMA.includes(level) && values.grant_schema.trim())
    ref.schema = values.grant_schema.trim()
  if (LEVELS_WITH_TABLE.includes(level) && values.grant_table.trim())
    ref.table = values.grant_table.trim()
  if (level === 'column' && values.grant_columns.trim()) {
    ref.columns = values.grant_columns
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean)
  }
  if (level === 'sequence' && values.grant_sequence.trim())
    ref.sequence = values.grant_sequence.trim()
  if (level === 'routine' && values.grant_routine_name.trim()) {
    ref.routine = { kind: values.grant_routine_kind, name: values.grant_routine_name.trim() }
  }
  return {
    level,
    object_ref: ref,
    privileges: values.grant_privileges,
    with_grant_option: values.grant_with_grant_option,
  }
}

interface ServerUserFormProps {
  mode: 'create' | 'edit'
  defaultValues?: Partial<ServerUserFormValues>
  /** En edición se muestran como solo lectura. */
  readonlyIdentity?: { username: string; host: string | null; serverName?: string }
  isSubmitting?: boolean
  /** `engine` es el del servidor elegido en el Combobox (null si aún no hay selección). */
  onSubmit: (values: ServerUserFormValues, engine: EngineType | null) => void
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
    setValue,
    formState: { errors },
  } = useForm<ServerUserFormValues>({
    resolver: zodResolver(buildSchema(mode)),
    defaultValues: { ...DEFAULTS, ...defaultValues },
  })

  const provision = watch('provision')
  const serverId = watch('server_id')
  const grantEnabled = watch('grant_enabled')
  const grantLevel = watch('grant_level')

  // Motor derivado del servidor seleccionado: gobierna el campo Host (PostgreSQL no lo usa)
  // y el catálogo de privilegios/niveles de la sección de permisos iniciales.
  const engine: EngineType | null =
    (servers.data ?? []).find((server) => server.id === serverId)?.engine ?? null
  const isPg = engine === 'postgresql'
  const levelOptions = grantLevelsForEngine(engine)

  return (
    <form
      onSubmit={handleSubmit((values) => onSubmit(values, engine))}
      className="flex flex-col gap-4"
      noValidate
    >
      {mode === 'create' ? (
        <>
          <Controller
            control={control}
            name="server_id"
            render={({ field, fieldState }) => (
              <Combobox<ServerOut>
                items={servers.data ?? []}
                value={servers.data?.find((s) => s.id === field.value) ?? null}
                onChange={(server) => {
                  field.onChange(server?.id ?? 0)
                  const nextEngine = server?.engine ?? null
                  if (nextEngine !== engine) {
                    // El catálogo de privilegios y los niveles válidos dependen del motor.
                    setValue('grant_privileges', [])
                    if (
                      nextEngine !== 'postgresql' &&
                      (grantLevel === 'schema' || grantLevel === 'sequence')
                    ) {
                      setValue('grant_level', 'database')
                    }
                  }
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
          <div className={isPg ? undefined : 'grid gap-4 sm:grid-cols-2'}>
            <Input
              label="Usuario"
              required
              error={errors.username?.message}
              {...register('username')}
            />
            {!isPg && (
              <Input
                label="Host"
                hint="Solo MySQL/MariaDB; «%» = cualquier host."
                error={errors.host?.message}
                {...register('host')}
              />
            )}
          </div>
          {isPg && (
            <p className="text-xs text-muted-foreground">
              PostgreSQL no usa host: el rol es global al servidor.
            </p>
          )}
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

      {mode === 'create' && provision && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <Controller
            control={control}
            name="grant_enabled"
            render={({ field }) => (
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                label="Permisos iniciales 🔌"
                hint="Otorga un primer grant en la misma llamada (/server-users/provision). Best-effort: si el grant falla, el usuario igual queda creado y aprovisionado."
              />
            )}
          />
          {grantEnabled && (
            <>
              <div className="w-full sm:max-w-xs">
                <Controller
                  control={control}
                  name="grant_level"
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
              <div className="grid gap-3 sm:grid-cols-2">
                {LEVELS_WITH_DATABASE.includes(grantLevel) && (
                  <Input label="Base de datos" {...register('grant_database')} />
                )}
                {isPg && LEVELS_WITH_SCHEMA.includes(grantLevel) && (
                  <Input
                    label="Esquema"
                    hint="PostgreSQL; default «public»."
                    {...register('grant_schema')}
                  />
                )}
                {LEVELS_WITH_TABLE.includes(grantLevel) && (
                  <Input label="Tabla" {...register('grant_table')} />
                )}
                {grantLevel === 'column' && (
                  <Input
                    label="Columnas"
                    hint="Separadas por coma."
                    {...register('grant_columns')}
                  />
                )}
                {grantLevel === 'sequence' && (
                  <Input label="Secuencia" {...register('grant_sequence')} />
                )}
                {grantLevel === 'routine' && (
                  <>
                    <Controller
                      control={control}
                      name="grant_routine_kind"
                      render={({ field }) => (
                        <Combobox
                          items={ROUTINE_KINDS}
                          value={field.value}
                          onChange={(value) => field.onChange(value ?? 'FUNCTION')}
                          itemToString={(value) => value}
                          itemToKey={(value) => value}
                          label="Tipo de rutina"
                        />
                      )}
                    />
                    <Input label="Nombre de la rutina" {...register('grant_routine_name')} />
                  </>
                )}
              </div>
              <Controller
                control={control}
                name="grant_privileges"
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <PrivilegeMultiSelect
                      engine={engine}
                      value={field.value}
                      onChange={field.onChange}
                    />
                    {errors.grant_privileges && (
                      <p className="text-xs text-error">{errors.grant_privileges.message}</p>
                    )}
                  </div>
                )}
              />
              <Controller
                control={control}
                name="grant_with_grant_option"
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    label="WITH GRANT OPTION"
                    hint="Permite al usuario re-delegar estos privilegios."
                  />
                )}
              />
            </>
          )}
        </div>
      )}

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
