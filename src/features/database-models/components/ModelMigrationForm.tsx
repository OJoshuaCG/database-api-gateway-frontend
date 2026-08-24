import { useEffect, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { MIGRATION_VERSION_PATTERN } from '@/lib/contracts'
import type { ModelMigrationCreate, ModelMigrationPatch } from '@/lib/contracts'
import { Badge, Button, Checkbox, Input } from '@/components/ui'
import { cn } from '@/lib/utils'
import { MigrationValidationPanel } from './MigrationValidationPanel'
import { SqlField } from './SqlField'

const SQL_MAX = 262144

export interface ModelMigrationFormValues {
  version: string
  name: string
  up_sql: string
  up_sql_mysql: string
  up_sql_postgresql: string
  down_sql: string
  /** Opt-in de captura de resultados de SELECT (api-reference-v9 §1/§6). */
  capture_selects: boolean
}

const DEFAULTS: ModelMigrationFormValues = {
  version: '',
  name: '',
  up_sql: '',
  up_sql_mysql: '',
  up_sql_postgresql: '',
  down_sql: '',
  capture_selects: false,
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
    capture_selects: z.boolean(),
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
    capture_selects: values.capture_selects,
  }
}

/** Cómo resolver un override cuando se corrige el `up_sql` base (Cambio 2). */
type OverrideChoice = 'resend' | 'clear'

interface ModelMigrationFormProps {
  mode: 'create' | 'edit'
  /** Sin él no se ofrece la validación: el endpoint cuelga del blueprint. */
  modelId?: number
  /** Collation de referencia del blueprint, para explicar un COLLATE forzado que difiera. */
  blueprintCollation?: string | null
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
  modelId,
  blueprintCollation,
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
  const currentDownSql = watch('down_sql')
  const currentMysqlOverride = watch('up_sql_mysql')
  const currentPostgresqlOverride = watch('up_sql_postgresql')
  const currentCaptureSelects = watch('capture_selects')
  const upSqlChanged = mode === 'edit' && currentUpSql !== originalUpSql
  const originalCaptureSelects = defaultValues?.capture_selects ?? false
  // Solo se manda `capture_selects` en el PATCH si realmente cambió: reenviar el mismo valor no
  // debería tener efecto, pero evitamos depender de que el backend lo trate como no-op (§3.1).
  const captureSelectsChanged = mode === 'edit' && currentCaptureSelects !== originalCaptureSelects
  // Activarlo por primera vez (o reactivarlo) resetea `reviewed` a `false` en la respuesta
  // (§2.3/§4.1): avisamos ANTES de guardar, no después de que el operador se sorprenda.
  const willResetReview = captureSelectsChanged && currentCaptureSelects

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
    if (captureSelectsChanged) patch.capture_selects = values.capture_selects
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

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-2">
          <Checkbox
            label="Capturar resultados de SELECT"
            hint="Guarda cifradas en el gateway las filas de cada SELECT del up_sql/down_sql (§0). Opt-in por versión: el gateway normalmente NO guarda datos de la base gestionada."
            {...register('capture_selects')}
          />
          {mode === 'edit' && currentCaptureSelects && (
            <Badge tone="warning" className="ml-auto shrink-0">
              Sin revisar hasta aprobar
            </Badge>
          )}
        </div>
        {willResetReview && (
          <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">
            Al guardar, esta versión quedará <strong>sin revisar</strong> (necesitará un «Revisar y
            aprobar» aparte): activar la captura por primera vez —o reactivarla— siempre resetea la
            revisión, aunque se apruebe en el mismo paso.
          </p>
        )}
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

      <SqlField
        label="up_sql (delta base, estilo MySQL)"
        value={currentUpSql}
        registration={register('up_sql')}
        required={mode === 'create'}
        readOnly={upSqlReadOnly}
        // Es el campo protagonista del formulario —el DDL que se va a ejecutar— y el único que
        // suele pasar de unas pocas líneas, así que arranca con bastante más altura que el resto.
        rows={16}
        emptyLabel="Sin SQL base."
        hint={
          mode === 'create'
            ? 'Se auto-traduce a PostgreSQL con sqlglot.'
            : 'Solo editable mientras no se haya aplicado con éxito. Al cambiarlo se regeneran el rollback sugerido y el checksum.'
        }
        error={
          errors.up_sql?.message ??
          (upSqlEmptyAfterChange ? 'El SQL base no puede quedar vacío.' : undefined)
        }
      />

      {upSqlChanged && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
          Editar el SQL base <strong>regenera el rollback sugerido y el checksum</strong>
          {(originalHasMysql || originalHasPostgresql) &&
            ', y exige re-confirmar los overrides por motor (reenviarlos corregidos o limpiarlos)'}
          .
        </div>
      )}

      <SqlField
        label="down_sql (rollback confirmado)"
        value={currentDownSql}
        registration={register('down_sql')}
        rows={8}
        emptyLabel="Sin rollback confirmado."
        hint="Sin él, el rollback responde 409. Revisa el sugerido y confírmalo aquí."
        error={errors.down_sql?.message}
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
              field={
                <SqlField
                  value={currentMysqlOverride}
                  registration={register('up_sql_mysql')}
                  rows={4}
                  readOnly={mysqlChoice !== 'resend'}
                  emptyLabel="Sin override para MySQL/MariaDB."
                  error={errors.up_sql_mysql?.message}
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
              field={
                <SqlField
                  value={currentPostgresqlOverride}
                  registration={register('up_sql_postgresql')}
                  rows={4}
                  readOnly={postgresqlChoice !== 'resend'}
                  emptyLabel="Sin override para PostgreSQL."
                  error={errors.up_sql_postgresql?.message}
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
            <SqlField
              label="up_sql_mysql (override MySQL/MariaDB)"
              value={currentMysqlOverride}
              registration={register('up_sql_mysql')}
              rows={4}
              emptyLabel="Sin override para MySQL/MariaDB."
              error={errors.up_sql_mysql?.message}
            />
            <SqlField
              label="up_sql_postgresql (override PostgreSQL)"
              value={currentPostgresqlOverride}
              registration={register('up_sql_postgresql')}
              rows={4}
              emptyLabel="Sin override para PostgreSQL."
              hint="Útil para ENUM inline, ON UPDATE CURRENT_TIMESTAMP, UNSIGNED, rutinas BEGIN…END."
              error={errors.up_sql_postgresql?.message}
            />
          </div>
        </details>
      )}

      {submitError && (
        <p className="rounded-lg border border-error/40 bg-error/5 p-3 text-xs text-error">
          {submitError}
        </p>
      )}

      {/* La validación va ANTES de la botonera: el orden de lectura es escribir → comprobar →
          guardar, y ponerla después invitaría a guardar sin haberla mirado. */}
      {modelId !== undefined && (
        <MigrationValidationPanel
          modelId={modelId}
          upSql={currentUpSql}
          blueprintCollation={blueprintCollation}
        />
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
  field,
}: {
  label: string
  choice: OverrideChoice | null
  onResend: () => void
  onClear: () => void
  field: ReactNode
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
        field
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
