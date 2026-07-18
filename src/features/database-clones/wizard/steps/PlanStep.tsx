import { Badge, Combobox, EmptyState, ErrorState, Input, Switch } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { CloneCleanMode, ServerOut, ServerUserOut } from '@/lib/contracts'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import type { CloneSourceOption } from '../logic'
import type { DatabaseCloneWizard, SourceMode } from '../use-database-clone-wizard'

const SOURCE_MODES: { value: SourceMode; label: string; hint: string }[] = [
  {
    value: 'inventory',
    label: 'Del inventario',
    hint: 'Elige una BD ya registrada en el gateway (cualquier servidor).',
  },
  {
    value: 'server',
    label: 'Por servidor (BD cruda)',
    hint: 'Elige un servidor y cualquiera de sus BDs en vivo, esté o no adoptada.',
  },
]

const CLEAN_MODES: { value: CloneCleanMode; label: string; hint: string }[] = [
  { value: 'none', label: 'Preservar', hint: 'Conserva lo que haya; los datos se copian por upsert.' },
  { value: 'objects', label: 'Borrar objetos', hint: 'Borra objeto por objeto; preserva la BD y su configuración.' },
  { value: 'drop_database', label: 'Reset total', hint: '🔴 DROP + CREATE de la BD: se pierde TODO lo que tenga.' },
]

function SourceOptionBadge({ option }: { option: CloneSourceOption }) {
  return (
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
  )
}

function RadioCard({
  name,
  checked,
  onChange,
  label,
  hint,
}: {
  name: string
  checked: boolean
  onChange: () => void
  label: string
  hint?: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
        checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
      )}
    >
      <span className="flex items-center gap-2 font-medium text-foreground">
        <input type="radio" name={name} className="accent-primary" checked={checked} onChange={onChange} />
        {label}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

/**
 * Vista 1 — formulario del plan: origen (inventario o BD cruda), destino (servidor + nombre,
 * nuevo o existente), opciones (datos, limpieza, adopción) y clon completo/parcial. Al confirmar,
 * `POST /database-clones` fotografía el origen y crea el job `pending`.
 */
export function PlanStep({ wizard }: { wizard: DatabaseCloneWizard }) {
  const { plan } = wizard
  const targetServer = wizard.serverOptions.data?.find((s) => s.id === plan.targetServerId) ?? null
  const sourceServerForPicker = wizard.serverOptions.data?.find((s) => s.id === plan.sourceServerId) ?? null
  const crossEngineHint =
    plan.source?.resolvedEngine != null &&
    targetServer?.engine != null &&
    plan.source.resolvedEngine !== targetServer.engine

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Clonar base de datos</h2>
        <p className="text-sm text-muted-foreground">
          Clona estructura y, opcionalmente, TODOS los datos a cualquier servidor (mismo motor o distinto).
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Origen</p>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          {SOURCE_MODES.map((mode) => (
            <RadioCard
              key={mode.value}
              name="source-mode"
              checked={plan.sourceMode === mode.value}
              onChange={() => wizard.setSourceMode(mode.value)}
              label={mode.label}
              hint={mode.hint}
            />
          ))}
        </fieldset>

        {plan.sourceMode === 'server' && (
          <Combobox<ServerOut>
            items={wizard.serverOptions.data ?? []}
            value={sourceServerForPicker}
            onChange={(server) => wizard.setSourceServerId(server?.id ?? null)}
            itemToString={(server) => server.name}
            itemToKey={(server) => server.id}
            renderItem={(server) => (
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{server.name}</span>
                <Badge tone="neutral">{server.engine}</Badge>
              </span>
            )}
            label="Servidor de origen"
            placeholder="Selecciona un servidor"
            isLoading={wizard.serverOptions.isLoading}
            clearable
            required
          />
        )}

        {wizard.sourceOptionsError ? (
          <ErrorState error={wizard.sourceOptionsError} title="No se pudieron cargar las bases de datos" />
        ) : plan.sourceMode === 'inventory' || plan.sourceServerId != null ? (
          !wizard.sourceOptionsLoading && wizard.sourceOptions.length === 0 ? (
            <EmptyState
              title="Sin bases de datos"
              description="No hay bases de datos disponibles para este origen."
            />
          ) : (
            <Combobox<CloneSourceOption>
              items={wizard.sourceOptions}
              value={plan.source}
              onChange={wizard.setSource}
              itemToString={(option) => option.name}
              itemToKey={(option) => option.key}
              renderItem={(option) => (
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">{option.name}</span>
                  <SourceOptionBadge option={option} />
                </span>
              )}
              label="Base de datos de origen"
              placeholder="Selecciona una base de datos"
              isLoading={wizard.sourceOptionsLoading}
              clearable
              required
            />
          )
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Destino</p>
        <Combobox<ServerOut>
          items={wizard.serverOptions.data ?? []}
          value={targetServer}
          onChange={(server) => wizard.setTargetServerId(server?.id ?? null)}
          itemToString={(server) => server.name}
          itemToKey={(server) => server.id}
          renderItem={(server) => (
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">{server.name}</span>
              <Badge tone="neutral">{server.engine}</Badge>
            </span>
          )}
          label="Servidor destino"
          placeholder="Selecciona un servidor"
          isLoading={wizard.serverOptions.isLoading}
          clearable
          required
        />

        <fieldset className="grid gap-2 sm:grid-cols-2">
          <RadioCard
            name="target-mode"
            checked={plan.targetMode === 'new'}
            onChange={() => wizard.setTargetMode('new')}
            label="Crear BD nueva"
          />
          <RadioCard
            name="target-mode"
            checked={plan.targetMode === 'existing'}
            onChange={() => wizard.setTargetMode('existing')}
            label="Usar BD existente"
          />
        </fieldset>

        {plan.targetMode === 'new' ? (
          <Input
            label="Nombre de la BD destino"
            value={plan.targetDatabaseName}
            onChange={(e) => wizard.setTargetDatabaseName(e.target.value)}
            placeholder="p. ej. productos_copia"
            required
          />
        ) : plan.targetServerId == null ? (
          <p className="text-xs text-muted-foreground">Elige primero el servidor destino.</p>
        ) : wizard.targetExistingError ? (
          <ErrorState error={wizard.targetExistingError} title="No se pudieron cargar las bases de datos" />
        ) : !wizard.targetExistingLoading && wizard.targetExistingOptions.length === 0 ? (
          <EmptyState title="Sin bases de datos" description="Este servidor no tiene bases de datos accesibles." />
        ) : (
          <Combobox<CloneSourceOption>
            items={wizard.targetExistingOptions}
            value={plan.targetExisting}
            onChange={wizard.setTargetExisting}
            itemToString={(option) => option.name}
            itemToKey={(option) => option.key}
            renderItem={(option) => (
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{option.name}</span>
                <SourceOptionBadge option={option} />
              </span>
            )}
            label="Base de datos destino existente"
            placeholder="Selecciona una base de datos"
            isLoading={wizard.targetExistingLoading}
            clearable
            required
          />
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opciones</p>
        <Switch
          checked={plan.includeData}
          onCheckedChange={wizard.setIncludeData}
          label="Incluir datos"
          hint="Copia TODAS las filas de las tablas seleccionadas; puede tardar."
        />

        {plan.targetMode === 'existing' && (
          <fieldset className="grid gap-2 sm:grid-cols-3">
            {CLEAN_MODES.map((mode) => (
              <RadioCard
                key={mode.value}
                name="clean-mode"
                checked={plan.cleanMode === mode.value}
                onChange={() => wizard.setCleanMode(mode.value)}
                label={mode.label}
                hint={mode.hint}
              />
            ))}
          </fieldset>
        )}

        <fieldset className="grid gap-2 sm:grid-cols-2">
          <RadioCard
            name="plan-mode"
            checked={plan.planMode === 'complete'}
            onChange={() => wizard.setPlanMode('complete')}
            label="Clon completo"
            hint="Toda la estructura del origen."
          />
          <RadioCard
            name="plan-mode"
            checked={plan.planMode === 'partial'}
            onChange={() => wizard.setPlanMode('partial')}
            label="Selección parcial"
            hint="Elegir objetos individuales en el paso siguiente."
          />
        </fieldset>

        {wizard.canAdoptTarget && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-3">
            <Switch
              checked={plan.adoptTarget}
              onCheckedChange={wizard.setAdoptTarget}
              label="Adoptar el destino y stampar el blueprint del origen"
              hint="Al terminar, el destino queda registrado en el gateway con el mismo blueprint/versión del origen."
            />
            {plan.adoptTarget && (
              <Combobox<ServerUserOut>
                items={wizard.ownerOptions.data ?? []}
                value={wizard.ownerOptions.data?.find((o) => o.id === plan.adoptOwnerId) ?? null}
                onChange={(owner) => wizard.setAdoptOwnerId(owner?.id ?? null)}
                itemToString={(owner) => owner.username}
                itemToKey={(owner) => owner.id}
                label="Propietario del destino"
                placeholder="Selecciona un usuario del servidor destino"
                isLoading={wizard.ownerOptions.isLoading}
                required
              />
            )}
          </div>
        )}
      </div>

      {crossEngineHint && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
          ⚠ Origen y destino son de motores distintos: solo se clonará lo portable al motor destino
          y los datos nunca se traducen entre motores.
        </p>
      )}

      {wizard.createClone.isError && (
        <ErrorRecoveryPanel
          error={wizard.createClone.error}
          title="No se pudo crear el plan de clonación"
          onSwitchToExistingTarget={() => wizard.setTargetMode('existing')}
          onSwitchToNewTarget={() => wizard.setTargetMode('new')}
        />
      )}
    </div>
  )
}
