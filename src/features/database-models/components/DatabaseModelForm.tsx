import type { ReactNode } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  CAPABILITIES,
  DATABASE_MODEL_ERROR_CODES,
  SLUG_PATTERN,
  type DatabaseModelCreate,
  type DatabaseModelUpdate,
} from '@/lib/contracts'
import type { ApiError } from '@/lib/api/errors'
import { Button, Checkbox, Input, Textarea } from '@/components/ui'
import { useCapabilityGuard } from '@/features/auth'
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
  /**
   * Cuántas BDs gestionadas tiene el blueprint. `undefined` = todavía no se sabe —la consulta sigue
   * en vuelo o falló— y se trata como «puede haber», que es el default seguro: la salida no es un
   * callejón, porque el asistente de renombrado sirve igual con cero bases.
   */
  managedDatabaseCount?: number
  /** Abre el asistente de renombrado. Sin él no se pinta el botón. */
  onRenameSlug?: () => void
  /**
   * Rechazo del ÚLTIMO envío, para pintarlo inline en el campo que lo causó en vez de dejarlo solo
   * en un toast: un 409 de unicidad se resuelve cambiando un campo concreto, y el toast no dice cuál.
   */
  submitError?: ApiError | null
  onSubmit: (values: DatabaseModelFormValues) => void
  onCancel: () => void
}

/** Un bloque del formulario con su título y su separador. */
function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * Alta y edición de un blueprint.
 *
 * ## Por qué el nombre y el slug están separados por una línea
 *
 * Son dos cosas distintas y se confundían porque estaban una al lado de la otra en la misma rejilla.
 * El **nombre** es una etiqueta para el humano: cambiarlo no toca ningún motor. El **slug** nombra
 * la tabla de versión `_gw_v_<slug>` **DENTRO de cada base gestionada**, así que cambiarlo con este
 * `PATCH` no renombra nada en ningún motor — el gateway pasa a leer una tabla que no existe y todas
 * esas bases pierden su contabilidad.
 *
 * Por eso, en `edit` y con bases asignadas, el campo va **deshabilitado** y la salida es el
 * asistente de renombrado, que sí hace el trabajo remoto. Sin bases asignadas el campo es editable
 * con normalidad: ahí el cambio sí es puramente local y bloquearlo sería fricción sin motivo.
 */
export function DatabaseModelForm({
  mode,
  defaultValues,
  isSubmitting,
  managedDatabaseCount,
  onRenameSlug,
  submitError,
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

  // Se clasifica por `public_context.code`, nunca por el status ni por la prosa (v25 §6).
  const slugInUse =
    submitError?.code === DATABASE_MODEL_ERROR_CODES.slugInUse
      ? submitError.databaseModelContext
      : undefined
  const taken = submitError?.code === DATABASE_MODEL_ERROR_CODES.nameOrSlugTaken
  // El 409 de unicidad no dice qué campo chocó. Si el backend manda `field_errors`, se respeta; si
  // no, se marcan los dos: pedirle al operador que adivine cuál cambiar es peor que marcar de más.
  const takenFields = submitError?.fieldErrors?.map((field) => field.field) ?? []
  const nameTaken = taken && (takenFields.length === 0 || takenFields.includes('name'))
  const slugTaken = taken && (takenFields.length === 0 || takenFields.includes('slug'))

  // El asistente escribe en bases ajenas: el requisito es `blueprints.write`. Se deshabilita el
  // control acá en vez de dejar que el 403 llegue tras leer el plan entero (v23 §4).
  const renameGuard = useCapabilityGuard(
    CAPABILITIES.blueprintsWrite,
    'renombrar el slug de un blueprint',
  )

  // `undefined` (todavía cargando, o la consulta falló) cuenta como «puede haber bases».
  const hasDatabases = managedDatabaseCount === undefined || managedDatabaseCount > 0
  const slugLocked = mode === 'edit' && hasDatabases

  const slugFieldError =
    errors.slug?.message ??
    (slugInUse ? 'Ese slug ya lo usa otro blueprint.' : undefined) ??
    (slugTaken ? 'Ese slug ya está en uso. Elegí otro valor.' : undefined)

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <Section
        title="Identificación humana"
        note="El nombre es solo para vos. Cambiarlo no toca ningún motor."
      >
        <Input
          label="Nombre"
          required
          error={
            errors.name?.message ??
            (nameTaken ? 'Ese nombre ya está en uso. Elegí otro valor.' : undefined)
          }
          {...register('name')}
        />
        <Textarea label="Descripción" rows={3} {...register('description')} />
      </Section>

      <Section
        title="Identificador para el motor 🔌"
        note="El slug nombra la tabla de versión que el gateway crea dentro de cada base gestionada."
      >
        <Input
          label="Slug"
          required
          disabled={slugLocked}
          hint="kebab/snake en minúsculas (ej. whatsapp)"
          error={slugFieldError}
          {...register('slug')}
        />

        {/* El aviso va BAJO el campo y siempre visible, nunca en un `title`: explica por qué el
            control está deshabilitado, y un tooltip se descubre por accidente —en táctil, ni eso. */}
        {slugLocked && (
          <p className="text-xs text-muted-foreground">
            El slug nombra la tabla de versión{' '}
            <code className="rounded bg-surface-muted px-1 py-0.5">_gw_v_&lt;slug&gt;</code>{' '}
            <strong className="text-foreground">DENTRO</strong> de cada una de las{' '}
            {managedDatabaseCount ?? 'las'} base(s) gestionadas. Cambiarlo acá las dejaría
            huérfanas: el gateway buscaría una tabla que ningún motor tiene.
          </p>
        )}
        {mode === 'edit' && !slugLocked && (
          <p className="text-xs text-muted-foreground">
            Sin bases asignadas: el cambio es local. Cuando cada base cree su tabla de versión, la
            creará ya con el nombre nuevo.
          </p>
        )}

        {/* El 409 se pinta con SUS TRES DATOS, no con el `message`: el conteo es lo que justifica el
            bloqueo, y sin los dos slugs el operador no sabe qué cambió respecto de lo que escribió. */}
        {slugInUse && (
          <div role="alert" className="rounded-lg border border-error/40 bg-error/5 p-3 text-xs">
            <p className="text-muted-foreground">
              <code className="rounded bg-surface-muted px-1 py-0.5">
                {slugInUse.currentSlug ?? '—'}
              </code>{' '}
              →{' '}
              <code className="rounded bg-surface-muted px-1 py-0.5">
                {slugInUse.requestedSlug ?? '—'}
              </code>{' '}
              afectaría a {slugInUse.managedDatabaseCount ?? '?'} base(s).
            </p>
          </div>
        )}

        {/* El asistente se ofrece con el campo bloqueado —es su única salida— y también con el campo
            libre si llegó un `slug_in_use`: el conteo de bases sale de caché y puede estar rancio,
            así que ese 409 es alcanzable aun creyendo que el blueprint no tiene ninguna. */}
        {onRenameSlug && (slugLocked || slugInUse) && (
          <div className="flex flex-col gap-1">
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!renameGuard.allowed}
                title={renameGuard.hint}
                onClick={onRenameSlug}
              >
                Renombrar el slug… 🔌
              </Button>
            </div>
            {/* El motivo, también como texto: el `title` de un control deshabilitado no llega ni al
                táctil ni al lector de pantalla, y aquí es lo único que dice a quién pedirle acceso. */}
            {renameGuard.hint && (
              <p className="text-xs text-muted-foreground">{renameGuard.hint}</p>
            )}
          </div>
        )}
      </Section>

      <Section title="Esquema y estado">
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
      </Section>

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
