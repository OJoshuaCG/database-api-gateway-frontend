import { Badge, Combobox, EmptyState, ErrorState } from '@/components/ui'
import { cn } from '@/lib/utils'
import { ENGINE_FAMILY_LABELS, type EngineFamily } from '../logic'
import type { DatabaseOption, SchemaComparisonWizard } from '../use-schema-comparison-wizard'

const FAMILIES: EngineFamily[] = ['mysql_mariadb', 'postgresql']

function DatabasePicker({
  label,
  options,
  value,
  onChange,
  isLoading,
}: {
  label: string
  options: DatabaseOption[]
  value: DatabaseOption | null
  onChange: (db: DatabaseOption | null) => void
  isLoading: boolean
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Combobox<DatabaseOption>
        items={options}
        value={value}
        onChange={onChange}
        itemToString={(db) => db.name}
        itemToKey={(db) => db.id}
        renderItem={(db) => (
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">{db.name}</span>
            <span className="flex shrink-0 items-center gap-1">
              {db.resolvedEngine && <Badge tone="neutral">{db.resolvedEngine}</Badge>}
              {db.model_id != null ? (
                <Badge tone="primary">🔒 blueprint</Badge>
              ) : (
                <Badge tone="neutral">sin blueprint</Badge>
              )}
            </span>
          </span>
        )}
        placeholder="Selecciona una base de datos"
        isLoading={isLoading}
        clearable
        required
      />
    </div>
  )
}

/** Vista 1 — motor + dos BDs (source/target) con dirección explícita; dispara la creación del diff. */
export function SelectorStep({ wizard }: { wizard: SchemaComparisonWizard }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Comparar esquemas de dos bases de datos</h2>
        <p className="text-sm text-muted-foreground">
          Solo estructura, nunca datos. Solo el mismo motor (se permite MySQL↔MariaDB).
        </p>
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-2">
        {FAMILIES.map((family) => (
          <label
            key={family}
            className={cn(
              'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
              wizard.family === family ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
            )}
          >
            <span className="flex items-center gap-2 font-medium text-foreground">
              <input
                type="radio"
                name="engine-family"
                className="accent-primary"
                checked={wizard.family === family}
                onChange={() => wizard.setFamily(family)}
              />
              {ENGINE_FAMILY_LABELS[family]}
            </span>
          </label>
        ))}
      </fieldset>

      {wizard.family === 'postgresql' && (
        <p className="rounded-lg border border-border bg-surface-muted p-3 text-xs text-muted-foreground">
          En PostgreSQL la comparación cubre únicamente el schema <code className="font-mono">public</code>.
        </p>
      )}

      {wizard.family &&
        (wizard.databasesError ? (
          <ErrorState
            error={wizard.databasesError}
            onRetry={wizard.refetchDatabases}
            title="No se pudieron cargar las bases de datos"
          />
        ) : !wizard.databasesLoading && wizard.databases.length === 0 ? (
          <EmptyState
            title="Sin bases de datos"
            description="No hay bases de datos gestionadas de este motor en el inventario."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <DatabasePicker
              label="SOURCE — referencia / estado deseado"
              options={wizard.sourceOptions}
              value={wizard.sourceDb}
              onChange={(db) => wizard.setSourceId(db?.id ?? null)}
              isLoading={wizard.databasesLoading}
            />
            <DatabasePicker
              label="TARGET — la BD que se modificaría"
              options={wizard.targetOptions}
              value={wizard.targetDb}
              onChange={(db) => wizard.setTargetId(db?.id ?? null)}
              isLoading={wizard.databasesLoading}
            />
          </div>
        ))}

      <p className="rounded-lg bg-surface-muted p-3 text-sm text-foreground">
        Todo el DDL será: qué correr en <strong>TARGET</strong> para que quede como{' '}
        <strong>SOURCE</strong>.
      </p>

      {wizard.crossFlavorWarning && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
          ⚠ Comparación entre familias (MySQL↔MariaDB): habrá ruido esperable (JSON/collations/
          secuencias). Revisa con cuidado.
        </p>
      )}

      {wizard.createComparisonState.isError && (
        <ErrorState
          error={wizard.createComparisonState.error}
          onRetry={wizard.createComparison}
          title="No se pudo crear la comparación"
        />
      )}
    </div>
  )
}
