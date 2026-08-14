import { useState } from 'react'
import { Badge, Button, CodeBlock, ConfirmDialog, ErrorState, Spinner, Switch } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { CollationConversionStepOut } from '@/lib/contracts'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import { classifyConversionError, CONVERSION_ACTION_HINTS, type ConversionErrorAction } from '../messages'
import type { CollationConversionWizard } from '../use-collation-conversion-wizard'

/** Traducción de `object_type` para los pasos del plan (incluye `database`/`table`, que no son
 * parte de `FrozenObjectType`, y los 5 tipos de objeto programable congelados). */
const OBJECT_TYPE_LABELS: Record<string, string> = {
  database: 'base de datos',
  table: 'tabla',
  procedure: 'procedimiento',
  function: 'función',
  trigger: 'disparador',
  event: 'evento',
  view: 'vista',
}

function objectTypeLabel(objectType: string): string {
  return OBJECT_TYPE_LABELS[objectType] ?? objectType
}

/**
 * Vista 3 — preview autoritativo del plan resuelto (pasos + advertencias) y ejecución con doble
 * confirmación (nombre exacto de la base + `confirm_token` del preview, §4.11/§6.3 del doc).
 *
 * A diferencia de `database-clones`, `WizardNav` devuelve `null` para este paso a propósito: el
 * footer entero (volver/ejecutar) y el `ConfirmDialog` viven acá, porque la confirmación de dos
 * factores necesita coordinar estado propio (apertura del modal) que no tiene sentido subir.
 */
export function PreviewStep({ wizard }: { wizard: CollationConversionWizard }) {
  const { preview } = wizard
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (preview.isLoading && !preview.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Resolviendo el plan…
      </div>
    )
  }

  if (preview.isError && !preview.data) {
    const action = classifyConversionError(toApiError(preview.error))
    // Caso puntual del doc (§5.5): el 409 de inventario desactualizado ofrece DOS salidas
    // concretas, no un botón genérico — `ErrorRecoveryPanel` solo sabe mostrar una acción.
    if (action === 'forceStaleInventory') {
      return (
        <div className="flex flex-col gap-3">
          <ErrorState error={preview.error} title="El inventario cambió desde que se creó el plan" />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                wizard.reloadInventory()
                wizard.goToStep('inventory')
              }}
            >
              Recargar inventario
            </Button>
            <Button variant="outline" onClick={wizard.refreshPreview}>
              Continuar con force
            </Button>
          </div>
        </div>
      )
    }
    return (
      <ErrorRecoveryPanel error={preview.error} title="No se pudo generar la vista previa" onReplan={wizard.replan} />
    )
  }

  const data = preview.data
  if (!data) return null

  const executeAction: ConversionErrorAction | null = wizard.execute.error
    ? classifyConversionError(toApiError(wizard.execute.error))
    : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Confirmar conversión de collation</h2>
        <p className="text-sm text-muted-foreground">
          Revisa exactamente qué se hará antes de ejecutar la conversión.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge tone="primary">{data.tables_to_convert} tabla(s) a convertir</Badge>
        <Badge tone="neutral">{data.tables_skipped} tabla(s) salteada(s)</Badge>
        {data.mode === 'columns' && data.columns_to_convert > 0 && (
          <Badge tone="primary">{data.columns_to_convert} columna(s) a convertir</Badge>
        )}
        {data.mode === 'universal' && data.objects_to_recreate > 0 && (
          <Badge tone="primary">{data.objects_to_recreate} objeto(s) a recrear</Badge>
        )}
        {data.include_database_default && <Badge tone="neutral">+ cambiar el default de la base</Badge>}
      </div>

      {(data.missing.length > 0 || data.missing_tables.length > 0) && (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-muted p-3 text-sm text-foreground">
          <p className="font-semibold">Elementos de la selección que ya no existen (excluidos del plan)</p>
          <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {data.missing_tables.map((name) => (
              <li key={`table:${name}`}>Tabla: {name}</li>
            ))}
            {data.missing.map((ref) => (
              <li key={`${ref.object_type}:${ref.name}`}>
                {objectTypeLabel(ref.object_type)}: {ref.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.warnings.map((warning, index) => (
        <p key={index} className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
          {warning}
        </p>
      ))}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-foreground">Pasos del plan ({data.steps.length})</p>
        <div className="flex flex-col gap-2">
          {data.steps.map((step, index) => (
            <StepCard key={`${step.action}:${step.object_type}:${step.object_name}:${index}`} step={step} />
          ))}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 mt-auto flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-elevated">
        <Button variant="ghost" onClick={() => wizard.goToStep('inventory')}>
          ← Volver a la selección
        </Button>
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          Ejecutar conversión 🔌
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          // `ConfirmDialog` maneja su input de "escribí X para confirmar" internamente y no
          // expone lo tipeado hacia afuera. No hace falta capturarlo a mano: su propio
          // `confirmWord` ya garantiza que el botón de confirmar solo se habilita cuando lo
          // tipeado coincide EXACTO con `wizard.database`, así que en el momento en que se puede
          // confirmar, ese valor es, por construcción, `wizard.database`.
          wizard.setConfirmTargetName(wizard.database)
          wizard.execute.mutate()
        }}
        title="Confirmar conversión de collation"
        confirmWord={wizard.database}
        confirmLabel={wizard.actionCooldown > 0 ? `Esperá ${wizard.actionCooldown}s` : 'Ejecutar conversión'}
        tone="danger"
        // `ConfirmDialog` no expone un `disabled` propio: se reusa `isLoading` (que ya deshabilita
        // el botón en `Button`) para cubrir también el cooldown de rate limit, no solo la mutación
        // en curso.
        isLoading={wizard.execute.isPending || wizard.actionCooldown > 0}
      >
        <p className="rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-foreground">
          🚨 Esta operación es IRREVERSIBLE, puede tardar horas y bloquea escrituras en las tablas grandes.
        </p>

        {wizard.execute.isError && (executeAction === 'forceQuarantine' || executeAction === 'forceStaleAtExecute') && (
          <div className="flex flex-col gap-2">
            <ErrorState error={wizard.execute.error} title="No se pudo ejecutar la conversión" />
            <Switch
              checked={wizard.force}
              onCheckedChange={wizard.setForce}
              label="Forzar ejecución"
              hint={CONVERSION_ACTION_HINTS[executeAction]}
            />
          </div>
        )}

        {wizard.execute.isError && executeAction === 'recomputeToken' && (
          <ErrorState error={wizard.execute.error} title="El plan cambió desde la vista previa, recalculando…" />
        )}

        {wizard.execute.isError &&
          (executeAction === 'fixConfirmName' ||
            executeAction === 'reviewSelection' ||
            executeAction === 'previewFirst' ||
            executeAction === 'none') && (
            <div className="flex flex-col gap-2">
              <ErrorState error={wizard.execute.error} title="No se pudo ejecutar la conversión" />
              {executeAction === 'reviewSelection' && (
                <Button
                  variant="outline"
                  className="self-start"
                  onClick={() => {
                    setConfirmOpen(false)
                    wizard.goToStep('inventory')
                  }}
                >
                  Revisar selección
                </Button>
              )}
            </div>
          )}
      </ConfirmDialog>
    </div>
  )
}

/** Una tarjeta por paso del plan, con el contenido y las advertencias visuales que exige `action`. */
function StepCard({ step }: { step: CollationConversionStepOut }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <StepHeader step={step} />
      {(step.action === 'alter_database' || step.action === 'convert_table' || step.action === 'convert_columns') &&
        step.sql && <CodeBlock code={step.sql} maxHeightClass="max-h-48" />}
      {step.action === 'recreate' && step.sql && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            El SQL de los pasos «recrear» se muestra como forma: el cuerpo real del objeto se captura
            durante la ejecución, esto NO es una sentencia para copiar y pegar.
          </p>
          <pre className="overflow-auto rounded-lg border border-border bg-syntax-bg p-3 font-mono text-xs text-syntax-plain">
            {step.sql}
          </pre>
        </div>
      )}
      {step.action === 'skip' && step.reason && <p className="text-xs text-muted-foreground">{step.reason}</p>}
      {step.columns && step.columns.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {step.columns.map((column) => (
            <li key={column} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {column}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StepHeader({ step }: { step: CollationConversionStepOut }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={step.action === 'skip' ? 'neutral' : 'primary'}>{objectTypeLabel(step.object_type)}</Badge>
      <span className="text-sm font-medium text-foreground">{step.object_name}</span>
    </div>
  )
}
