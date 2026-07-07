import { useEffect, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { MIGRATION_VERSION_PATTERN } from '@/lib/contracts'
import type { ModelMigrationCreate, ModelMigrationPatch } from '@/lib/contracts'
import { Button, Input, Textarea } from '@/components/ui'
import { cn } from '@/lib/utils'

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
    // En create, `version` es opcional: vacío ⇒ el gateway autoasigna la siguiente secuencial.
    version:
      mode === 'create'
        ? z
            .string()
            .regex(MIGRATION_VERSION_PATTERN, 'Solo dígitos, 4–10 (ej. 0001)')
            .or(z.literal(''))
        : z.string(),
    name: z.string().min(1, 'Requerido').max(200, 'Máximo 200 caracteres'),
    // En edit no exigimos min(1): una versión con up_sql vacío (p. ej. baseline aprobado por
    // separado) debe poder editar su nombre/down_sql. El vaciado al *cambiarlo* se bloquea aparte.
    up_sql:
      mode === 'create'
        ? z.string().min(1, 'Requerido').max(SQL_MAX, 'Máximo 256 KB')
        : z.string().max(SQL_MAX, 'Máximo 256 KB'),
    up_sql_mysql: z.string().max(SQL_MAX, 'Máximo 256 KB'),
    up_sql_postgresql: z.string().max(SQL_MAX, 'Máximo 256 KB'),
    down_sql: z.string().max(SQL_MAX, 'Máximo 256 KB'),
  })
}

const orNull = (value: string) => (value.trim() ? value : null)

export function toCreate(values: ModelMigrationFormValues): ModelMigrationCreate {
  return {
    // Omitir la versión cuando está vacía: el gateway asigna la siguiente secuencial (max+1).
    version: values.version.trim() || undefined,
    name: values.name.trim(),
    up_sql: values.up_sql,
    up_sql_mysql: orNull(values.up_sql_mysql),
    up_sql_postgresql: orNull(values.up_sql_postgresql),
    down_sql: orNull(values.down_sql),
  }
}

/** Cómo resolver un override cuando se corrige el `up_sql` base (Cambio 2). */
type OverrideChoice = 'resend' | 'clear'

const monospace = 'font-mono text-xs'

interface ModelMigrationFormProps {
  mode: 'create' | 'edit'
  defaultValues?: Partial<ModelMigrationFormValues>
  isSubmitting?: boolean
  /** Mensaje de error del backend (detail.msg) a mostrar en línea (edit). */
  submitError?: string | null
  /** `409` caso A: el `up_sql` ya se aplicó con éxito ⇒ bloquear su edición (fix-forward). */
  upSqlLocked?: boolean
  /** CTA de fix-forward: crear una nueva migración en vez de editar la aplicada. */
  onCreateNewVersion?: () => void
  /** create: recibe los valores crudos (el llamador arma el `ModelMigrationCreate`). */
  onSubmit?: (values: ModelMigrationFormValues) => void
  /** edit: recibe el `ModelMigrationPatch` ya resuelto (up_sql solo si cambió + overrides). */
  onSubmitEdit?: (patch: ModelMigrationPatch) => void
  onCancel: () => void
}

export function ModelMigrationForm({
  mode,
  defaultValues,
  isSubmitting,
  submitError,
  upSqlLocked = false,
  onCreateNewVersion,
  onSubmit,
  onSubmitEdit,
  onCancel,
}: ModelMigrationFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ModelMigrationFormValues>({
    resolver: zodResolver(buildSchema(mode)),
    defaultValues: { ...DEFAULTS, ...defaultValues },
  })

  const originalUpSql = defaultValues?.up_sql ?? ''
  // Valores originales de los overrides (strings estables por versión: la clave del form remonta
  // al cambiar de versión). Se usan para restaurarlos si el usuario revierte el up_sql.
  const originalMysqlOverride = defaultValues?.up_sql_mysql ?? ''
  const originalPostgresqlOverride = defaultValues?.up_sql_postgresql ?? ''
  const originalHasMysql = Boolean(originalMysqlOverride)
  const originalHasPostgresql = Boolean(originalPostgresqlOverride)

  // ¿Se tocó el SQL base? (solo relevante en edit; en create no hay "original").
  const currentUpSql = watch('up_sql')
  const upSqlChanged = mode === 'edit' && currentUpSql !== originalUpSql

  // Resolución de overrides al cambiar up_sql: cada override existente debe reenviarse o limpiarse.
  const [mysqlChoice, setMysqlChoice] = useState<OverrideChoice | null>(null)
  const [postgresqlChoice, setPostgresqlChoice] = useState<OverrideChoice | null>(null)

  // Si el usuario revierte el up_sql a su valor original, ya no hay que resolver nada: se limpian
  // las decisiones y se RESTAURAN los overrides originales (si los había "limpiado", no se pierden).
  useEffect(() => {
    if (!upSqlChanged) {
      setMysqlChoice(null)
      setPostgresqlChoice(null)
      setValue('up_sql_mysql', originalMysqlOverride)
      setValue('up_sql_postgresql', originalPostgresqlOverride)
    }
  }, [upSqlChanged, setValue, originalMysqlOverride, originalPostgresqlOverride])

  const needMysqlResolution = upSqlChanged && originalHasMysql
  const needPostgresqlResolution = upSqlChanged && originalHasPostgresql
  // No se puede guardar hasta resolver cada override, ni dejar el up_sql cambiado y vacío.
  const upSqlEmptyAfterChange = upSqlChanged && currentUpSql.trim().length === 0
  const cannotSubmit =
    (needMysqlResolution && mysqlChoice === null) ||
    (needPostgresqlResolution && postgresqlChoice === null) ||
    upSqlEmptyAfterChange

  const submitEdit = (values: ModelMigrationFormValues) => {
    const patch: ModelMigrationPatch = {
      name: values.name.trim(),
      down_sql: orNull(values.down_sql),
    }
    // El up_sql solo viaja si realmente cambió: así editar solo el nombre no dispara el 409-A.
    if (upSqlChanged) patch.up_sql = values.up_sql
    // Overrides: si hay que resolverlos, "limpiar" ⇒ null; en el resto de casos, el valor tal cual.
    patch.up_sql_mysql =
      needMysqlResolution && mysqlChoice === 'clear' ? null : orNull(values.up_sql_mysql)
    patch.up_sql_postgresql =
      needPostgresqlResolution && postgresqlChoice === 'clear'
        ? null
        : orNull(values.up_sql_postgresql)
    onSubmitEdit?.(patch)
  }

  const submit = (values: ModelMigrationFormValues) => {
    if (mode === 'create') onSubmit?.(values)
    else submitEdit(values)
  }

  const upSqlReadOnly = mode === 'edit' && upSqlLocked

  return (
    <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Versión (opcional)"
          readOnly={mode === 'edit'}
          placeholder={mode === 'create' ? 'auto (siguiente secuencial)' : undefined}
          hint={
            mode === 'create'
              ? 'Déjalo vacío para autoasignar la siguiente (recomendado), o fíjala a mano.'
              : 'Inmutable.'
          }
          error={errors.version?.message}
          {...register('version')}
        />
        <Input label="Nombre" required error={errors.name?.message} {...register('name')} />
      </div>

      {upSqlReadOnly && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
          <p>
            Esta versión ya se <strong>aplicó con éxito</strong> en al menos una BD, por lo que su
            SQL base no puede modificarse (fix-forward). Crea una nueva migración con la corrección.
          </p>
          {onCreateNewVersion && (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={onCreateNewVersion}>
                Nueva migración
              </Button>
            </div>
          )}
        </div>
      )}

      <Textarea
        label="up_sql (delta base, estilo MySQL)"
        required={mode === 'create'}
        readOnly={upSqlReadOnly}
        rows={6}
        className={monospace}
        hint={
          mode === 'create'
            ? 'Se auto-traduce a PostgreSQL con sqlglot.'
            : 'Solo editable mientras no se haya aplicado con éxito. Al cambiarlo se regeneran el rollback sugerido y el checksum.'
        }
        error={
          errors.up_sql?.message ??
          (upSqlEmptyAfterChange ? 'El SQL base no puede quedar vacío.' : undefined)
        }
        {...register('up_sql')}
      />

      {upSqlChanged && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
          Editar el SQL base <strong>regenera el rollback sugerido y el checksum</strong>
          {(originalHasMysql || originalHasPostgresql) &&
            ', y exige re-confirmar los overrides por motor (reenviarlos corregidos o limpiarlos)'}
          .
        </div>
      )}

      <Textarea
        label="down_sql (rollback confirmado)"
        rows={4}
        className={monospace}
        hint="Sin él, el rollback responde 409. Revisa el sugerido y confírmalo aquí."
        error={errors.down_sql?.message}
        {...register('down_sql')}
      />

      {needMysqlResolution || needPostgresqlResolution ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-foreground">Re-confirma los overrides por motor</p>
          {originalHasMysql && (
            <OverrideResolution
              label="up_sql_mysql (override MySQL/MariaDB)"
              choice={mysqlChoice}
              onResend={() => setMysqlChoice('resend')}
              onClear={() => {
                setMysqlChoice('clear')
                setValue('up_sql_mysql', '')
              }}
              textarea={
                <Textarea
                  rows={4}
                  className={monospace}
                  readOnly={mysqlChoice !== 'resend'}
                  error={errors.up_sql_mysql?.message}
                  {...register('up_sql_mysql')}
                />
              }
            />
          )}
          {originalHasPostgresql && (
            <OverrideResolution
              label="up_sql_postgresql (override PostgreSQL)"
              choice={postgresqlChoice}
              onResend={() => setPostgresqlChoice('resend')}
              onClear={() => {
                setPostgresqlChoice('clear')
                setValue('up_sql_postgresql', '')
              }}
              textarea={
                <Textarea
                  rows={4}
                  className={monospace}
                  readOnly={postgresqlChoice !== 'resend'}
                  error={errors.up_sql_postgresql?.message}
                  {...register('up_sql_postgresql')}
                />
              }
            />
          )}
        </div>
      ) : (
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
      )}

      {submitError && (
        <p className="rounded-lg border border-error/40 bg-error/5 p-3 text-xs text-error">
          {submitError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" isLoading={isSubmitting} disabled={cannotSubmit}>
          {mode === 'create' ? 'Crear migración' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}

/** Un override existente que hay que reenviar corregido o limpiar (null) al cambiar el up_sql. */
function OverrideResolution({
  label,
  choice,
  onResend,
  onClear,
  textarea,
}: {
  label: string
  choice: OverrideChoice | null
  onResend: () => void
  onClear: () => void
  textarea: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <div className="flex gap-1.5">
          <ChoiceButton active={choice === 'resend'} onClick={onResend}>
            Reenviar corregido
          </ChoiceButton>
          <ChoiceButton active={choice === 'clear'} onClick={onClear}>
            Limpiar (null)
          </ChoiceButton>
        </div>
      </div>
      {choice === 'clear' ? (
        <p className="text-xs text-muted-foreground">
          El override se eliminará: el motor usará la traducción automática del nuevo SQL base.
        </p>
      ) : (
        textarea
      )}
    </div>
  )
}

function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-input text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
