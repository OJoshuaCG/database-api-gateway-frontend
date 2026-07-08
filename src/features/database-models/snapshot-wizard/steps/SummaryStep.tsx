import { Badge, Button, Input, Textarea } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { SnapshotLayout } from '@/lib/contracts'
import { summarizeCounts } from '../logic'
import { describeViolation, violationTarget } from '../messages'
import type { SnapshotWizard } from '../use-snapshot-wizard'

const LAYOUT_LABELS: Record<SnapshotLayout, string> = {
  single: 'Todo en una versión',
  by_class: 'Una versión por clase',
  manual: 'Manual (buckets ordenados)',
}

/** Vista 6 — identidad del blueprint, recap y submit con manejo de errores por código. */
export function SummaryStep({ wizard }: { wizard: SnapshotWizard }) {
  const engine = wizard.snapshot.data?.source_engine
  const nonPortable = !wizard.schemaPortable || wizard.dataCount > 0
  const canSubmit = wizard.name.trim().length > 0 && wizard.slugValid && !wizard.create.isPending

  const error = wizard.create.error ? toApiError(wizard.create.error) : null
  const is409 = error?.status === 409
  const is422 = error?.status === 422
  const is429 = error?.status === 429
  const violations = error?.violations ?? []

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Resumen y confirmación</h2>
        <p className="text-sm text-muted-foreground">
          Revisa la identidad y lo que se creará. Ninguna versión se aplica hasta revisarla y
          aprobarla.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          label="Nombre del blueprint"
          required
          value={wizard.name}
          onChange={(event) => wizard.setName(event.target.value)}
          error={is409 ? 'Ya existe un blueprint con ese nombre o slug' : undefined}
        />
        <Input
          label="Slug"
          required
          value={wizard.slug}
          onChange={(event) => wizard.setSlug(event.target.value)}
          hint="Identificador estable (kebab/snake en minúsculas)."
          error={
            wizard.slug && !wizard.slugValid
              ? 'kebab/snake en minúsculas (ej. crm-legacy)'
              : is409
                ? 'Ya existe un blueprint con ese slug'
                : undefined
          }
        />
        <Textarea
          label="Descripción (opcional)"
          rows={2}
          value={wizard.description}
          onChange={(event) => wizard.setDescription(event.target.value)}
        />
        <Input
          label="Nombre del baseline"
          value={wizard.baselineName}
          onChange={(event) => wizard.setBaselineName(event.target.value)}
          hint="Nombre de la versión 0001."
        />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
        <p className="text-sm font-medium text-foreground">Se creará</p>
        <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Origen</dt>
          <dd className="text-foreground">
            servidor #{wizard.serverId} · BD <code className="font-mono">{wizard.database}</code>
            {engine && <> · motor {engine}</>}
          </dd>
          <dt className="text-muted-foreground">Layout</dt>
          <dd className="text-foreground">{LAYOUT_LABELS[wizard.layout]}</dd>
          <dt className="text-muted-foreground">Objetos</dt>
          <dd className="flex flex-wrap items-center gap-2 text-foreground">
            {summarizeCounts(wizard.selectedCounts)}
            <Badge tone={wizard.schemaPortable ? 'success' : 'warning'}>
              {wizard.schemaPortable ? 'portable' : 'no portable'}
            </Badge>
          </dd>
          <dt className="text-muted-foreground">Datos-semilla</dt>
          <dd className="text-foreground">
            {wizard.dataCount === 0
              ? 'ninguno'
              : wizard.dataSelections.map((sel) => `${sel.table} (${sel.mode})`).join(', ')}
            {wizard.dataCount > 0 && <> · on_oversize: {wizard.onOversize}</>}
          </dd>
          <dt className="text-muted-foreground">Rollback de datos</dt>
          <dd className="text-foreground">
            {wizard.dataCount === 0
              ? '—'
              : wizard.confirmDataRollback
                ? 'confirmado (DELETE por PK)'
                : 'solo sugerencia'}
          </dd>
        </dl>
      </div>

      {nonPortable && engine && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
          Este blueprint quedará atado al motor <strong>{engine}</strong> y no podrá aplicarse a
          otros motores.
        </p>
      )}

      {error && (
        <div className="flex flex-col gap-2 rounded-lg border border-error/30 bg-error/5 p-3">
          <p className="text-sm font-semibold text-error">{error.message}</p>
          {is429 && (
            <p className="text-sm text-muted-foreground">
              Límite de 10/min excedido. Espera un momento e inténtalo de nuevo.
            </p>
          )}
          {is422 && violations.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-foreground">
              {violations.map((violation, index) => {
                const target = violationTarget(violation)
                return (
                  <li key={index} className="flex items-start gap-2">
                    <span aria-hidden className="text-error">
                      •
                    </span>
                    <span>
                      {target && <code className="mr-1 font-mono text-xs">{target}</code>}
                      {describeViolation(violation)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {is422 && wizard.layout === 'manual' && (
              <Button variant="outline" size="sm" onClick={() => wizard.goToStep('manual')}>
                Revisar layout manual
              </Button>
            )}
            {is422 && wizard.dataCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => wizard.goToStep('data')}>
                Revisar datos-semilla
              </Button>
            )}
            {error.requestId && (
              <span className="text-xs text-muted-foreground">
                ID de solicitud: <code className="font-mono">{error.requestId}</code>
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={wizard.back} disabled={wizard.create.isPending}>
          ← Atrás
        </Button>
        <Button onClick={wizard.submit} disabled={!canSubmit} isLoading={wizard.create.isPending}>
          Crear blueprint
        </Button>
      </div>
    </div>
  )
}
