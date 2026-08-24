import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  IDENTIFIER_PATTERN,
  type DatabaseModelOut,
  type EnvironmentOut,
  type ManagedDatabaseCreate,
  type ManagedDatabaseUpdate,
  type ServerOut,
  type ServerUserOut,
} from '@/lib/contracts'
import { Button, Combobox, Input, Textarea } from '@/components/ui'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import { useDatabaseModelOptions } from '@/features/database-models/hooks/use-database-model-options'
import { useSelectableEnvironments } from '@/features/environments'
import {
  CharsetCollationSelector,
  engineToFamily,
  type CharsetCollationValue,
} from '@/features/charset-collation-options'

export interface ManagedDatabaseFormValues {
  name: string
  server_id: number
  owner_id: number
  model_id: number | null
  model_version: string
  /** `null` = sin clasificar. En `create` es obligatorio; ver `buildSchema`. */
  environment_id: number | null
  charsetCollation: CharsetCollationValue | null | undefined
  notes: string
}

const DEFAULTS: ManagedDatabaseFormValues = {
  name: '',
  server_id: 0,
  owner_id: 0,
  model_id: null,
  model_version: '',
  environment_id: null,
  charsetCollation: undefined,
  notes: '',
}

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
    // REQUERIDO en el alta a propósito: el backend asigna `development` si no se manda, así que
    // un campo vacío *significa* development — la misma mentira que se corrigió con
    // `model_version`. Una elección explícita cuesta un click y elimina toda la clase de fallo
    // "nadie notó que se fue por default". En `edit` es nullable porque `null` desclasifica.
    environment_id:
      mode === 'create'
        ? z.number().int().min(1, 'Selecciona un entorno')
        : z.number().int().min(1).nullable(),
    // Sin validación propia: el selector solo produce valores válidos del catálogo, y en modo
    // `edit` ni se muestra ni se envía.
    charsetCollation: z.custom<CharsetCollationValue | null | undefined>(),
    notes: z.string(),
  })
}

export function toManagedDatabaseCreate(values: ManagedDatabaseFormValues): ManagedDatabaseCreate {
  return {
    name: values.name.trim(),
    server_id: values.server_id,
    owner_id: values.owner_id,
    model_id: values.model_id,
    model_version: values.model_version.trim() ? values.model_version.trim() : null,
    environment_id: values.environment_id as number,
    charset: values.charsetCollation ? values.charsetCollation.charset : null,
    collation: values.charsetCollation ? values.charsetCollation.collation : null,
    notes: values.notes.trim() ? values.notes.trim() : null,
  }
}

/**
 * Body del PATCH construido **por PRESENCIA de la clave, no por valor**, y eso no es un detalle
 * de estilo: es lo que impide un fallo silencioso grave.
 *
 * El backend usa `exclude_unset`, así que *clave presente = cambio pedido*, y
 * `environment_id: null` DESCLASIFICA — lo que además le quita a la base la protección del guard
 * de migraciones destructivas (una BD sin entorno pasa el guard). Con el mapeo anterior, que
 * mandaba SIEMPRE todas las claves, editar solo las **notas** de una base de `production` le
 * habría quitado el entorno, con toast de éxito. El disparador sería la acción más inocua de la
 * app.
 *
 * `?? null` NO alcanza: el problema no es el valor por defecto, es que la clave viaje.
 *
 * `model_version` ya no está: el backend dejó de aceptarlo y lo descarta en silencio, así que
 * seguir mandándolo hacía que la UI mintiera. Se mantiene en `create` y en `adopt`.
 */
export function toManagedDatabaseUpdate(
  values: ManagedDatabaseFormValues,
  dirtyFields: Partial<Record<keyof ManagedDatabaseFormValues, unknown>>,
): ManagedDatabaseUpdate {
  const body: ManagedDatabaseUpdate = {}
  if (dirtyFields.model_id) body.model_id = values.model_id
  if (dirtyFields.notes) body.notes = values.notes.trim() ? values.notes.trim() : null
  if (dirtyFields.environment_id) body.environment_id = values.environment_id
  return body
}

interface ManagedDatabaseFormProps {
  mode: 'create' | 'edit'
  defaultValues?: Partial<ManagedDatabaseFormValues>
  readonlyIdentity?: { name: string; serverName?: string }
  readonlyCharsetCollation?: { charset: string | null; collation: string | null }
  isSubmitting?: boolean
  /**
   * Recibe también `dirtyFields`: el PATCH se construye por presencia de la clave, no por
   * valor (ver `toManagedDatabaseUpdate`). Sin esto, guardar el formulario mandaría
   * `environment_id` incluso sin haberlo tocado, y `null` desclasifica.
   */
  onSubmit: (
    values: ManagedDatabaseFormValues,
    dirtyFields: Partial<Record<keyof ManagedDatabaseFormValues, unknown>>,
  ) => void
  onCancel: () => void
}

export function ManagedDatabaseForm({
  mode,
  defaultValues,
  readonlyIdentity,
  readonlyCharsetCollation,
  isSubmitting,
  onSubmit,
  onCancel,
}: ManagedDatabaseFormProps) {
  const environments = useSelectableEnvironments()
  const selectableEnvironments = environments.selectable

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<ManagedDatabaseFormValues>({
    resolver: zodResolver(buildSchema(mode)),
    defaultValues: { ...DEFAULTS, ...defaultValues },
  })

  const servers = useServerOptions()
  const selectedServerId = watch('server_id')
  const owners = useServerUserOptions(selectedServerId || null)
  const models = useDatabaseModelOptions()
  const selectedServer = servers.data?.find((s) => s.id === selectedServerId)
  const engineFamily = selectedServerId ? engineToFamily(selectedServer?.engine ?? 'mysql') : null

  return (
    <form onSubmit={handleSubmit((values) => onSubmit(values, dirtyFields))} className="flex flex-col gap-4" noValidate>
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
                    const previousServer = servers.data?.find((s) => s.id === field.value)
                    const previousFamily = previousServer
                      ? engineToFamily(previousServer.engine)
                      : null
                    const nextFamily = server ? engineToFamily(server.engine) : null
                    field.onChange(server?.id ?? 0)
                    setValue('owner_id', 0) // el owner debe ser del mismo servidor
                    if (previousFamily !== nextFamily) {
                      setValue('charsetCollation', undefined) // cambió la familia de motor
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

      {/*
        Va acá y NO en el grid de metadata de abajo: ese bloque está encuadrado como "editar esto
        no modifica la base en el servidor", y el entorno es el ÚNICO campo de este formulario que
        cambia si el servidor va a negarse a ejecutar un DDL.
      */}
      <Controller
        control={control}
        name="environment_id"
        render={({ field, fieldState }) => (
          <Combobox<EnvironmentOut>
            items={selectableEnvironments}
            value={selectableEnvironments.find((e) => e.id === field.value) ?? null}
            onChange={(env) => field.onChange(env?.id ?? null)}
            itemToString={(e) =>
              e.blocks_destructive_migrations ? `${e.name} · bloquea destructivas` : e.name
            }
            itemToKey={(e) => e.id}
            label="Entorno"
            required={mode === 'create'}
            isLoading={environments.isLoading}
            placeholder="Selecciona un entorno"
            hint={
              mode === 'create'
                ? 'Obligatorio: no hay default silencioso. Un entorno puede bloquear las migraciones destructivas.'
                : 'Reclasificar cambia si el servidor acepta migraciones destructivas en esta base.'
            }
            error={fieldState.error?.message}
            /*
              SIN `clearable` en edición: desclasificar es DEBILITAR (una base sin entorno pasa el
              guard), y el backend exige repetir el slug para debilitar un entorno. La UI no puede
              dar ese mismo efecto con una × de 12px. Para desclasificar, por API.
            */
            clearable={mode === 'create'}
          />
        )}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {/*
          `model_version` solo en el ALTA: el backend dejó de aceptarlo en el PATCH y lo descarta
          en silencio, así que mostrarlo en edición hacía que la UI mintiera (se escribe, se
          guarda, sale el toast de éxito y el valor no cambió). Para declararla a mano está
          `POST /{id}/migrations/stamp`, que sí la valida contra el blueprint.
        */}
        {mode === 'create' && (
          <Input
            label="Versión del modelo"
            error={errors.model_version?.message}
            {...register('model_version')}
          />
        )}
        {mode === 'create' && (
          <Controller
            control={control}
            name="charsetCollation"
            render={({ field, fieldState }) => (
              <CharsetCollationSelector
                engineFamily={engineFamily}
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        )}
      </div>

      {mode === 'edit' && (
        <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm">
          <p className="text-foreground">
            Charset: {readonlyCharsetCollation?.charset ?? 'no se especificó (la definió el motor)'}
          </p>
          <p className="text-foreground">
            Collation:{' '}
            {readonlyCharsetCollation?.collation ?? 'no se especificó (la definió el motor)'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Metadata del inventario. Editar esto no modifica la base de datos en el servidor.
          </p>
        </div>
      )}

      <Textarea label="Notas" rows={2} {...register('notes')} />

      {/*
        Acá vivía un switch «Aprovisionar en el motor» que nacía APAGADO, y se quitó a
        propósito: era el único productor de filas `pending` de todo el sistema —bases que
        figuran en el inventario y no existen en el motor—, un estado que nada leía como guard
        y que hacía fallar todo lo demás después con errores opacos. Los casos que decía cubrir
        ya tienen dueño mejor: para traer al inventario una base que YA existe está «Adoptar»,
        que verifica su existencia y la deja `active`; y el alta exige un servidor ya cargado
        con credenciales, así que «todavía no tengo acceso al motor» no se sostiene. Crear es
        crear. La vía «solo inventario» sigue existiendo en la API (`?provision=false`) para
        scripting, y las filas históricas se recuperan con el botón «Aprovisionar» del listado.
      */}

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
