import { useState } from 'react'
import { Badge, Button, Input, Spinner, Switch } from '@/components/ui'
import { ApiError } from '@/lib/api/errors'
import type { CollationBatchExecuteIn, CollationBatchPlanOut } from '@/lib/contracts'
import {
  CapabilityHint,
  isSkippedByScope,
  SkippedByScopeCallout,
  type CapabilityGuard,
} from '@/features/auth'
import {
  BATCH_ITEM_LABEL,
  BATCH_ITEM_TONE,
  batchDatabaseLabel,
  classifyBatchItem,
  collationMessage,
} from '../messages'

/**
 * Paso 2 del lote: revisar el plan y confirmar.
 *
 * **Por qué el formulario pide tres cosas y no una.** Convertir base por base costaba un re-tipeo
 * del nombre por cada una; un lote reemplazaría N re-tipeos por un click. El `batch_token` no
 * repone ese control: lo genera el servidor, así que aporta FRESCURA, no INTENCIÓN. Por eso el
 * contrato exige el slug del blueprint, el conjunto de bases echado de vuelta, y el nombre
 * re-tipeado de cada base cuyo entorno bloquee migraciones destructivas.
 *
 * **`requires_confirmation` llega en el 422, no en el plan.** Es decir: el primer intento de
 * ejecutar es el que revela qué bases exigen re-tipeo. No es un ida y vuelta desperdiciado —
 * evita pedir por adelantado algo que en la mayoría de los blueprints no hace falta— pero sí
 * obliga a que este paso sepa reaccionar a ese 422 en vez de tratarlo como un error terminal.
 */
export function BatchConfirmStep({
  plan,
  isExecuting,
  executeError,
  onExecute,
  onReplan,
  guard,
}: {
  plan: CollationBatchPlanOut
  isExecuting: boolean
  executeError: unknown
  onExecute: (body: CollationBatchExecuteIn) => void
  onReplan: () => void
  /** `collation.execute` (`POST .../collation-conversions/{batch_id}/execute`). */
  guard?: CapabilityGuard
}) {
  const [slug, setSlug] = useState('')
  const [confirmations, setConfirmations] = useState<Record<string, string>>({})
  const [force, setForce] = useState(false)

  const apiError = executeError instanceof ApiError ? executeError : null
  const ctx = apiError?.collationContext
  const codeMessage = collationMessage(apiError?.code)

  /** Qué bases pidió re-tipear el backend. Vacío hasta que el primer intento devuelva el 422. */
  const requiresConfirmation = ctx?.requiresConfirmation ?? []
  const needsRetype = new Set(requiresConfirmation)

  /**
   * El conjunto previsualizado, TAL CUAL vino: no se recorta ni se filtra por `ok` (solo se
   * apartan las omitidas por scope, que no son parte del lote).
   *
   * El backend valida esto fail-closed y rechaza cualquier diferencia — recortarlo acá "porque
   * esas no se van a convertir igual" sería adivinar su criterio. Si aun así no coincide, el 422
   * trae los dos conjuntos y se muestran abajo, así que el desacuerdo es visible en vez de ser un
   * muro.
   */
  /*
   * Las omitidas por la capa 2 (`access.forbidden`) vienen en `databases` pero NO son parte del
   * lote: no tienen job ni `batch_seq`, y el backend arma el conjunto que valida con las que sí.
   * Reenviarlas haría fallar el «mismo conjunto» con un 422 que el operador no puede arreglar.
   */
  const skipped = plan.databases.filter(isSkippedByScope)
  const inBatch = plan.databases.filter((db) => !isSkippedByScope(db))
  const databaseIds = inBatch.map((db) => db.managed_database_id)

  const slugMatches = slug.trim() === plan.model_slug
  const retypesComplete = requiresConfirmation.every((id) => {
    const expected = inBatch.find((db) => db.managed_database_id === id)?.database_name
    return !!expected && confirmations[String(id)]?.trim() === expected
  })
  const canExecute = slugMatches && retypesComplete && !isExecuting

  return (
    <div className="flex flex-col gap-6">
      {/* `capped` se muestra o se miente: sin esto el operador cree que convirtió el blueprint entero. */}
      {plan.capped && (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          El blueprint tiene <strong>{plan.total_eligible}</strong> bases activas y el tope es{' '}
          <strong>{plan.max_databases}</strong>: este lote convierte solo las primeras{' '}
          {inBatch.length}. Las demás quedan sin convertir.
        </div>
      )}

      {/*
        Que el lote corra EN SERIE no es un detalle de implementación: es la diferencia entre un
        monitor que parece colgado y uno que se entiende.
      */}
      {plan.runs_serially && (
        <div className="rounded-md border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
          Las bases se convierten <strong>una después de otra</strong>, no en paralelo. Un lote de{' '}
          {inBatch.length} bases con tablas grandes puede tardar horas.
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {inBatch.length} base{inBatch.length === 1 ? '' : 's'} en el lote
        </h2>
        <SkippedByScopeCallout ids={skipped.map((db) => db.managed_database_id)} noun="base" />
        <ul className="flex flex-col gap-2">
          {inBatch.map((db) => {
            const outcome = classifyBatchItem(db)
            const id = String(db.managed_database_id)
            return (
              <li
                key={id}
                className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {db.batch_seq !== null && (
                    <span className="font-mono text-xs text-muted-foreground">#{db.batch_seq}</span>
                  )}
                  <span className="font-medium text-foreground">{batchDatabaseLabel(db)}</span>
                  <Badge tone={BATCH_ITEM_TONE[outcome]}>{BATCH_ITEM_LABEL[outcome]}</Badge>
                  {outcome === 'ok' && (
                    <span className="text-muted-foreground">
                      {db.tables_to_convert} tabla{db.tables_to_convert === 1 ? '' : 's'} ·{' '}
                      {db.objects_to_recreate} objeto{db.objects_to_recreate === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                {!db.ok && (
                  <p className="text-muted-foreground">
                    {collationMessage(db.error_code) ?? db.error ?? 'No se pudo planificar.'}
                  </p>
                )}

                {/* Los warnings del plan dicen, entre otras cosas, que los objetos quedan congelados. */}
                {db.warnings.map((warning) => (
                  <p key={warning} className="text-warning">
                    {warning}
                  </p>
                ))}

                {db.missing_tables.length > 0 && (
                  <p className="text-muted-foreground">
                    Tablas del plan que ya no existen: {db.missing_tables.join(', ')}
                  </p>
                )}

                {needsRetype.has(db.managed_database_id) && (
                  <Input
                    label={`Escribí "${db.database_name}" para confirmar`}
                    value={confirmations[id] ?? ''}
                    onChange={(event) =>
                      setConfirmations((prev) => ({ ...prev, [id]: event.target.value }))
                    }
                    disabled={isExecuting}
                    hint="Su entorno bloquea migraciones destructivas."
                    error={
                      (confirmations[id] ?? '') === '' ||
                      confirmations[id]?.trim() === db.database_name
                        ? undefined
                        : 'No coincide con el nombre de la base'
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {/* El desacuerdo de conjuntos se muestra entero: es la única forma de que sea diagnosticable. */}
      {ctx?.plannedDatabaseIds && ctx.receivedDatabaseIds && (
        <div className="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
          <p>El conjunto de bases no coincide con el que se planificó.</p>
          <p className="mt-1 font-mono text-xs">
            Planificadas: {ctx.plannedDatabaseIds.join(', ')}
            <br />
            Enviadas: {ctx.receivedDatabaseIds.join(', ')}
          </p>
        </div>
      )}

      {(codeMessage ?? apiError) && (
        <div className="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
          {codeMessage ?? apiError?.message}
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <Input
          label={`Escribí el identificador del blueprint (${plan.model_slug}) para confirmar`}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          disabled={isExecuting}
          error={slug === '' || slugMatches ? undefined : 'No coincide'}
        />

        <Switch
          checked={force}
          onCheckedChange={setForce}
          disabled={isExecuting}
          label="Forzar bases en cuarentena o con inventario cambiado"
          hint="Override por base. NO amplía el conjunto ni reemplaza el re-tipeo de las bases de entorno protegido."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() =>
            onExecute({
              confirm_model_slug: slug.trim(),
              confirm_token: plan.batch_token,
              database_ids: databaseIds,
              confirmations,
              force,
            })
          }
          disabled={!canExecute || (guard ? !guard.allowed : false)}
          aria-describedby={guard?.describedBy}
        >
          {isExecuting && <Spinner />}
          Convertir {inBatch.length} base{inBatch.length === 1 ? '' : 's'} 🔌
        </Button>
        <Button variant="ghost" onClick={onReplan} disabled={isExecuting}>
          Volver a planificar
        </Button>
        {guard && <CapabilityHint guard={guard} className="basis-full" />}
      </div>
    </div>
  )
}
