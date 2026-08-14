import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Combobox, ErrorState, Input, Spinner } from '@/components/ui'
import { AlertIcon } from '@/components/ui/icons'
import { toApiError } from '@/lib/api/errors'
import { CharsetCollationSelector, type CharsetCollationValue } from '@/features/charset-collation-options'
import type { CollationOptionOut } from '@/lib/contracts'
import { useCreateCollationConversion } from '../../hooks/use-collation-conversion-actions'
import { useCollationConversionObjects } from '../../hooks/use-collation-conversions'
import type { CollationConversionWizard } from '../use-collation-conversion-wizard'

/**
 * Paso 1 — objetivo de la conversión: elegir charset/collation (MySQL/MariaDB) o solo collation
 * (PostgreSQL) y disparar `createPlan`. El botón "Crear plan" vive en `WizardNav` (ya construido);
 * este paso solo puebla `wizard.targetCharset`/`wizard.targetCollation` y muestra los errores que
 * `WizardNav` no muestra.
 */

const IRREVERSIBLE_NOTICE =
  'Esta operación es IRREVERSIBLE y no tiene deshacer. Volver atrás requiere otra conversión, ' +
  'con el mismo costo y el mismo riesgo.'

const IMMUTABLE_ENCODING_NOTICE =
  'El ENCODING y el LC_COLLATE de la base son inmutables: esta operación cambia la collation de ' +
  'las COLUMNAS de texto, no la de la base.'

function WarningBanner({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <span>{children}</span>
    </p>
  )
}

/** `provider` de `pg_collation`: código corto del backend → etiqueta legible. */
function formatCollationOptionLabel(option: CollationOptionOut): string {
  const provider =
    option.provider === 'i'
      ? 'ICU'
      : option.provider === 'c'
        ? 'libc'
        : option.provider === 'b'
          ? 'builtin'
          : '—'
  // El sufijo "no determinista" es una advertencia real (rompe LIKE/regex en PostgreSQL 12-17):
  // se muestra en el momento de elegir, no solo más adelante en el preview.
  return option.deterministic ? `${option.name} (${provider})` : `${option.name} (${provider}) — no determinista`
}

/** MySQL/MariaDB — reusa el selector cerrado del catálogo de creación de bases (v7). */
function UniversalPlanFields({ wizard }: { wizard: CollationConversionWizard }) {
  const apiError = wizard.createPlan.error ? toApiError(wizard.createPlan.error) : null

  const selectorValue: CharsetCollationValue | undefined =
    wizard.targetCollation === ''
      ? undefined
      : { charset: wizard.targetCharset ?? '', collation: wizard.targetCollation }

  function handleChange(value: CharsetCollationValue | null) {
    // `CharsetCollationSelector` fue diseñado para el catálogo de CREACIÓN de bases, donde
    // `collation: null` y la pseudo-opción "usar el valor por defecto del motor" (value === null)
    // son elecciones legítimas. Para ESTA operación NO lo son: `target_collation` siempre debe ser
    // una collation concreta, así que ambos casos se tratan como "todavía no se eligió nada válido".
    if (value === null || value.collation === null) {
      wizard.setTargetCharset(null)
      wizard.setTargetCollation('')
      return
    }
    wizard.setTargetCharset(value.charset)
    wizard.setTargetCollation(value.collation)
  }

  return (
    <div className="flex flex-col gap-3">
      <CharsetCollationSelector
        engineFamily="mysql"
        value={selectorValue}
        onChange={handleChange}
        overrideOptions={apiError?.charsetRejected?.allowed}
        disabled={wizard.createPlan.isPending}
        label="Juego de caracteres y ordenamiento objetivo"
      />
      {apiError && (
        <p className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {apiError.message}
          {apiError.charsetRejected?.truncated &&
            ' Se muestran las primeras 50 opciones; hay más disponibles.'}
        </p>
      )}
    </div>
  )
}

/**
 * PostgreSQL — mecanismo del "plan sonda" [SUPUESTO F1]: no hay endpoint de catálogo de
 * collations por servidor todavía, así que se crea un plan descartable con `target_collation: "C"`
 * (existe en prácticamente todo PostgreSQL) solo para leer su inventario y obtener
 * `available_collations`. El sonda nunca se convierte en el plan real: usa sus propias mutación/
 * query, separadas de `wizard.createPlan`/`wizard.objects`. Se abandona solo (expira en 24 h).
 * Transitorio hasta que el backend exponga ese catálogo.
 */
function ColumnsPlanFields({ wizard }: { wizard: CollationConversionWizard }) {
  const [probeJobId, setProbeJobId] = useState<number | null>(null)
  const probeAttemptedRef = useRef(false)
  const probeCreate = useCreateCollationConversion()

  useEffect(() => {
    if (wizard.mode !== 'columns' || probeAttemptedRef.current) return
    probeAttemptedRef.current = true
    probeCreate.mutate(
      { serverId: wizard.serverId, database: wizard.database, body: { target_collation: 'C' } },
      { onSuccess: (job) => setProbeJobId(job.id) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.mode])

  function retryProbe() {
    probeCreate.mutate(
      { serverId: wizard.serverId, database: wizard.database, body: { target_collation: 'C' } },
      { onSuccess: (job) => setProbeJobId(job.id) },
    )
  }

  const probeApiError = probeCreate.isError ? toApiError(probeCreate.error) : null
  const createPlanError = wizard.createPlan.error ? toApiError(wizard.createPlan.error) : null
  const probeObjects = useCollationConversionObjects(probeJobId ?? 0, probeJobId != null)

  return (
    <div className="flex flex-col gap-3">
      {probeJobId === null && probeCreate.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Cargando las collations disponibles en este servidor…
        </div>
      )}

      {probeJobId === null &&
        probeApiError &&
        (probeApiError.postgresCollationRejected ? (
          <Input
            label="Collation objetivo"
            value={wizard.targetCollation}
            onChange={(e) => {
              wizard.setTargetCharset(null)
              wizard.setTargetCollation(e.target.value)
            }}
            hint={`${probeApiError.message} No se pudo cargar el catálogo de collations de este servidor: escribí el nombre exacto.`}
            placeholder="p. ej. es_ES.utf8"
            required
          />
        ) : (
          <ErrorState
            error={probeCreate.error}
            title="No se pudo cargar el catálogo de collations del servidor"
            onRetry={retryProbe}
          />
        ))}

      {probeJobId != null &&
        (probeObjects.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Cargando las collations disponibles en este servidor…
          </div>
        ) : probeObjects.isError ? (
          <ErrorState
            error={probeObjects.error}
            title="No se pudo cargar el catálogo de collations del servidor"
            onRetry={() => probeObjects.refetch()}
          />
        ) : probeObjects.data ? (
          <Combobox<CollationOptionOut>
            items={probeObjects.data.available_collations}
            itemToKey={(c) => c.name}
            itemToString={formatCollationOptionLabel}
            value={
              probeObjects.data.available_collations.find((c) => c.name === wizard.targetCollation) ?? null
            }
            onChange={(item) => {
              wizard.setTargetCharset(null)
              wizard.setTargetCollation(item?.name ?? '')
            }}
            label="Collation objetivo"
            hint="Estas son las collations instaladas en ESTE servidor."
          />
        ) : null)}

      {createPlanError && (
        <p className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {createPlanError.message}
          {createPlanError.postgresCollationRejected &&
            ` Hay ${createPlanError.postgresCollationRejected.availableCount} collations disponibles en este servidor.`}
        </p>
      )}
    </div>
  )
}

export function PlanStep({ wizard }: { wizard: CollationConversionWizard }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Convertir collation de la base de datos</h2>
        <p className="text-sm text-muted-foreground">
          Re-alinea el charset y la collation de {wizard.database} hacia un valor único, en toda la
          estructura y (según el motor) las columnas de texto.
        </p>
      </div>

      <WarningBanner>{IRREVERSIBLE_NOTICE}</WarningBanner>
      {wizard.mode === 'columns' && <WarningBanner>{IMMUTABLE_ENCODING_NOTICE}</WarningBanner>}

      {wizard.mode === 'universal' ? (
        <UniversalPlanFields wizard={wizard} />
      ) : (
        <ColumnsPlanFields wizard={wizard} />
      )}
    </div>
  )
}
