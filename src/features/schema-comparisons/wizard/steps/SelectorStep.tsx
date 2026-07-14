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
    hint: 'Cada lado elige su propio servidor y cualquiera de sus BDs, esté o no adoptada.',
  },
]

const FAMILIES: EngineFamily[] = ['mysql_mariadb', 'postgresql']

function DatabasePicker({
  options,
  value,
  onChange,
  isLoading,
}: {
  options: DatabaseSideOption[]
  value: DatabaseSideOption | null
  onChange: (option: DatabaseSideOption | null) => void
  isLoading: boolean
}) {
  return (
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
      label="Base de datos"
      placeholder="Selecciona una base de datos"
      isLoading={isLoading}
      clearable
      required
    />
  )
}

/** Vista 1, modo "por motor" — panel simple: la BD sale de la lista ya filtrada por familia. */
function FamilyModePanel({
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
      <DatabasePicker options={options} value={value} onChange={onChange} isLoading={isLoading} />
    </div>
  )
}

/**
 * Vista 1, modo "por servidor" — panel compuesto: PRIMERO su propio servidor, LUEGO la BD de ese
 * servidor (adoptada o cruda). Cada lado (source/target) monta su propia instancia: no comparten
 * servidor entre sí, cada uno es 100% independiente (así lo exige el backend).
 */
function ServerScopedPanel({
  label,
  servers,
  serversLoading,
  pickerServerId,
  onServerChange,
  databaseOptions,
  databaseValue,
  onDatabaseChange,
  databaseLoading,
  databaseError,
  onRetryDatabases,
}: {
  label: string
  servers: ServerOut[]
  serversLoading: boolean
  pickerServerId: number | null
  onServerChange: (serverId: number | null) => void
  databaseOptions: DatabaseSideOption[]
  databaseValue: DatabaseSideOption | null
  onDatabaseChange: (option: DatabaseSideOption | null) => void
  databaseLoading: boolean
  databaseError: unknown
  onRetryDatabases: () => void
}) {
  const selectedServer = servers.find((server) => server.id === pickerServerId) ?? null

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Combobox<ServerOut>
        items={servers}
        value={selectedServer}
        onChange={(server) => onServerChange(server?.id ?? null)}
        itemToString={(server) => server.name}
        itemToKey={(server) => server.id}
        renderItem={(server) => (
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">{server.name}</span>
            <Badge tone="neutral">{server.engine}</Badge>
          </span>
        )}
        label="Servidor"
        placeholder="Selecciona un servidor"
        isLoading={serversLoading}
        clearable
        required
      />
      {pickerServerId != null &&
        (databaseError ? (
          <ErrorState
            error={databaseError}
            onRetry={onRetryDatabases}
            title="No se pudieron cargar las bases de datos"
          />
        ) : !databaseLoading && databaseOptions.length === 0 ? (
          <EmptyState
            title="Sin bases de datos"
            description="Este servidor no tiene bases de datos accesibles."
          />
        ) : (
          <DatabasePicker
            options={databaseOptions}
            value={databaseValue}
            onChange={onDatabaseChange}
            isLoading={databaseLoading}
          />
        ))}
    </div>
  )
}

/**
 * Vista 1 — dos modos de selección: "por motor" (BDs adoptadas, comportamiento original) y "por
 * servidor" (feature "referencias crudas": cada lado elige su PROPIO servidor de forma 100%
 * independiente del otro — el backend no tiene ningún concepto de "servidor de la comparación"
 * compartido; comparar servidores distintos, p. ej. staging vs producción, es el caso de uso
 * principal). Ambos modos alimentan el mismo `sourceSelection`/`targetSelection` del wizard.
 */
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

          {wizard.family &&
            (wizard.sourceOptionsError ? (
              <ErrorState
                error={wizard.sourceOptionsError}
                onRetry={wizard.refetchSourceOptions}
                title="No se pudieron cargar las bases de datos"
              />
            ) : !wizard.sourceOptionsLoading && wizard.sourceOptions.length === 0 && wizard.targetOptions.length === 0 ? (
              <EmptyState
                title="Sin bases de datos"
                description="No hay bases de datos gestionadas de este motor en el inventario."
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <FamilyModePanel
                  label="SOURCE — referencia / estado deseado"
                  options={wizard.sourceOptions}
                  value={wizard.sourceSelection}
                  onChange={wizard.setSourceSelection}
                  isLoading={wizard.sourceOptionsLoading}
                />
                <FamilyModePanel
                  label="TARGET — la BD que se modificaría"
                  options={wizard.targetOptions}
                  value={wizard.targetSelection}
                  onChange={wizard.setTargetSelection}
                  isLoading={wizard.targetOptionsLoading}
                />
              </div>
            ))}
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <ServerScopedPanel
            label="SOURCE — referencia / estado deseado"
            servers={wizard.sourceServerChoices}
            serversLoading={wizard.serverOptions.isLoading}
            pickerServerId={wizard.sourcePickerServerId}
            onServerChange={wizard.setSourcePickerServerId}
            databaseOptions={wizard.sourceOptions}
            databaseValue={wizard.sourceSelection}
            onDatabaseChange={wizard.setSourceSelection}
            databaseLoading={wizard.sourceOptionsLoading}
            databaseError={wizard.sourceOptionsError}
            onRetryDatabases={wizard.refetchSourceOptions}
          />
          <ServerScopedPanel
            label="TARGET — la BD que se modificaría"
            servers={wizard.targetServerChoices}
            serversLoading={wizard.serverOptions.isLoading}
            pickerServerId={wizard.targetPickerServerId}
            onServerChange={wizard.setTargetPickerServerId}
            databaseOptions={wizard.targetOptions}
            databaseValue={wizard.targetSelection}
            onDatabaseChange={wizard.setTargetSelection}
            databaseLoading={wizard.targetOptionsLoading}
            databaseError={wizard.targetOptionsError}
            onRetryDatabases={wizard.refetchTargetOptions}
          />
        </div>
      )}

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
