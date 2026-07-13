import { Badge, Combobox, EmptyState, ErrorState } from '@/components/ui'
import type { ServerOut } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { ENGINE_FAMILY_LABELS, type DatabaseSideOption, type EngineFamily } from '../logic'
import type { SchemaComparisonWizard, SelectionMode } from '../use-schema-comparison-wizard'

const SELECTION_MODES: { value: SelectionMode; label: string; hint: string }[] = [
  {
    value: 'family',
    label: 'Por motor (BDs adoptadas)',
    hint: 'Compara dos BDs ya registradas en el inventario, incluso de servidores distintos.',
  },
  {
    value: 'server',
    label: 'Por servidor (incluye BDs sin registrar)',
    hint: 'Elige un servidor y compara cualquiera de sus BDs, esté o no adoptada.',
  },
]

const FAMILIES: EngineFamily[] = ['mysql_mariadb', 'postgresql']

function DatabasePicker({
  label,
  options,
  value,
  onChange,
  isLoading,
}: {
  label: string
  options: DatabaseSideOption[]
  value: DatabaseSideOption | null
  onChange: (option: DatabaseSideOption | null) => void
  isLoading: boolean
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Combobox<DatabaseSideOption>
        items={options}
        value={value}
        onChange={onChange}
        itemToString={(option) => option.name}
        itemToKey={(option) => option.key}
        renderItem={(option) => (
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">{option.name}</span>
            <span className="flex shrink-0 items-center gap-1">
              {option.resolvedEngine && <Badge tone="neutral">{option.resolvedEngine}</Badge>}
              {option.managedId == null ? (
                <Badge tone="warning">sin registrar</Badge>
              ) : option.modelId != null ? (
                <Badge tone="primary">🔒 blueprint</Badge>
              ) : (
                <Badge tone="neutral">adoptada</Badge>
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

/**
 * Vista 1 — dos modos de selección: "por motor" (BDs adoptadas, comportamiento original) y "por
 * servidor" (feature "referencias crudas": incluye BDs vivas del motor sin registrar en el
 * inventario). Ambos alimentan el mismo `sourceSelection`/`targetSelection` del wizard.
 */
export function SelectorStep({ wizard }: { wizard: SchemaComparisonWizard }) {
  const showPickers =
    wizard.selectionMode === 'family' ? Boolean(wizard.family) : wizard.pickerServerId != null
  const selectedServer =
    wizard.pickerServerId != null
      ? (wizard.serverOptions.data?.find((server) => server.id === wizard.pickerServerId) ?? null)
      : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Comparar esquemas de dos bases de datos</h2>
        <p className="text-sm text-muted-foreground">
          Solo estructura, nunca datos. Solo el mismo motor (se permite MySQL↔MariaDB).
        </p>
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-2">
        {SELECTION_MODES.map((mode) => (
          <label
            key={mode.value}
            className={cn(
              'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
              wizard.selectionMode === mode.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-surface-muted',
            )}
          >
            <span className="flex items-center gap-2 font-medium text-foreground">
              <input
                type="radio"
                name="selection-mode"
                className="accent-primary"
                checked={wizard.selectionMode === mode.value}
                onChange={() => wizard.setSelectionMode(mode.value)}
              />
              {mode.label}
            </span>
            <span className="text-xs text-muted-foreground">{mode.hint}</span>
          </label>
        ))}
      </fieldset>

      {wizard.selectionMode === 'family' ? (
        <>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            {FAMILIES.map((family) => (
              <label
                key={family}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
                  wizard.family === family
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-surface-muted',
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
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Servidor</p>
          <Combobox<ServerOut>
            items={wizard.serverOptions.data ?? []}
            value={selectedServer}
            onChange={(server) => wizard.setPickerServerId(server?.id ?? null)}
            itemToString={(server) => server.name}
            itemToKey={(server) => server.id}
            renderItem={(server) => (
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{server.name}</span>
                <Badge tone="neutral">{server.engine}</Badge>
              </span>
            )}
            placeholder="Selecciona un servidor"
            isLoading={wizard.serverOptions.isLoading}
            clearable
          />
        </div>
      )}

      {showPickers &&
        (wizard.optionsError ? (
          <ErrorState
            error={wizard.optionsError}
            onRetry={wizard.refetchOptions}
            title="No se pudieron cargar las bases de datos"
          />
        ) : !wizard.optionsLoading && wizard.options.length === 0 ? (
          <EmptyState
            title="Sin bases de datos"
            description={
              wizard.selectionMode === 'server'
                ? 'Este servidor no tiene bases de datos accesibles.'
                : 'No hay bases de datos gestionadas de este motor en el inventario.'
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <DatabasePicker
              label="SOURCE — referencia / estado deseado"
              options={wizard.sourceOptions}
              value={wizard.sourceSelection}
              onChange={wizard.setSourceSelection}
              isLoading={wizard.optionsLoading}
            />
            <DatabasePicker
              label="TARGET — la BD que se modificaría"
              options={wizard.targetOptions}
              value={wizard.targetSelection}
              onChange={wizard.setTargetSelection}
              isLoading={wizard.optionsLoading}
            />
          </div>
        ))}

      <p className="rounded-lg bg-surface-muted p-3 text-sm text-foreground">
        Todo el DDL será: qué correr en <strong>TARGET</strong> para que quede como{' '}
        <strong>SOURCE</strong>.
      </p>

      {wizard.targetSelection && wizard.targetSelection.managedId == null && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
          ℹ Esta BD target no está registrada en el inventario: solo podrás <strong>ejecutar
          directo</strong> el diff (Opción B); no se puede adoptar como versión de blueprint.
        </p>
      )}

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
