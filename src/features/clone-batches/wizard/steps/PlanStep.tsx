import { Callout, Combobox, Input, RadioCardGroup } from '@/components/ui'
import type { CloneCopyIntent, CloneDataOnExisting, ServerOut } from '@/lib/contracts'
import type { CloneBatchWizard } from '../use-clone-batch-wizard'

/**
 * Paso 1 — los dos servidores y el perfil que comparten todas las bases del lote.
 *
 * El aviso de «el lote no borra» va acá y no al final a propósito: es la restricción que
 * explica por qué después algunas filas no van a poder usar un destino existente, y leerla
 * recién en el error sería descubrirla tarde.
 */
const INTENT_OPTIONS: { value: CloneCopyIntent; label: string; hint: string }[] = [
  {
    value: 'structure_and_data',
    label: 'Estructura y datos',
    hint: 'Todo: tablas, vistas, rutinas, triggers, eventos y las filas. Crea las bases destino.',
  },
  {
    value: 'structure_only',
    label: 'Solo estructura',
    hint: 'Los objetos, sin una sola fila. Útil para preparar un servidor vacío.',
  },
  {
    value: 'data_only',
    label: 'Solo datos',
    hint: 'No emite DDL: exige que las bases destino ya existan con su estructura creada.',
  },
]

const ON_EXISTING_OPTIONS: { value: CloneDataOnExisting; label: string; hint: string }[] = [
  {
    value: 'append',
    label: 'Agregar filas',
    hint: 'Inserta sin tocar lo que ya está. Reejecutar duplicaría filas.',
  },
  {
    value: 'upsert',
    label: 'Insertar o actualizar',
    hint: 'Sobre tablas SIN clave primaria degrada a inserción simple.',
  },
]

export function PlanStep({ wizard }: { wizard: CloneBatchWizard }) {
  const { plan, serverOptions } = wizard
  const servers = serverOptions.data ?? []
  const source = servers.find((s) => s.id === plan.sourceServerId) ?? null
  const target = servers.find((s) => s.id === plan.targetServerId) ?? null
  const crossEngine = source && target && source.engine !== target.engine

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">De qué servidor a cuál</h2>
        <p className="text-sm text-muted-foreground">
          El lote copia varias bases de un servidor a otro, de a una por vez.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Combobox<ServerOut>
          label="Servidor origen"
          items={servers}
          value={source}
          onChange={(server) => wizard.setSourceServerId(server?.id ?? null)}
          itemToString={(server) => (server ? `${server.name} (${server.engine})` : '')}
          itemToKey={(server) => String(server.id)}
          placeholder="Elegí el servidor de origen"
        />
        <Combobox<ServerOut>
          label="Servidor destino"
          items={servers}
          value={target}
          onChange={(server) => wizard.setTargetServerId(server?.id ?? null)}
          itemToString={(server) => (server ? `${server.name} (${server.engine})` : '')}
          itemToKey={(server) => String(server.id)}
          placeholder="Elegí el servidor de destino"
        />
      </div>

      {crossEngine && (
        <Callout tone="warning" title="Los motores son distintos">
          Se clonará lo portable y se informará lo que quede afuera. Entre familias distintas,
          las rutinas, los triggers y los eventos no se pueden trasladar.
        </Callout>
      )}

      <RadioCardGroup<CloneCopyIntent>
        title="Qué copiar de cada base"
        options={INTENT_OPTIONS}
        value={plan.copyIntent}
        onChange={wizard.setCopyIntent}
        columns={3}
        name="clone-batch-intent"
      />

      {plan.copyIntent === 'data_only' && (
        <RadioCardGroup<CloneDataOnExisting>
          title="Qué hacer con las filas que ya estén en el destino"
          description="No hay opción de vaciar las tablas: el lote nunca borra nada."
          options={ON_EXISTING_OPTIONS}
          value={plan.dataOnExisting}
          onChange={wizard.setDataOnExisting}
          columns={2}
          name="clone-batch-on-existing"
        />
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recortar qué objetos se copian (opcional)
        </p>
        <p className="text-xs text-muted-foreground">
          Se aplica igual a todas las bases del lote. Vacío = todo el contenido de cada base.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Incluir solo los que coincidan"
            placeholder="fact_*, dim_*"
            value={plan.rule.includePatterns}
            onChange={(event) => wizard.setRuleIncludePatterns(event.target.value)}
            hint="Patrones separados por coma. * y ? comodines, sensible a mayúsculas."
          />
          <Input
            label="Excluir los que coincidan"
            placeholder="log_*, tmp_*"
            value={plan.rule.excludePatterns}
            onChange={(event) => wizard.setRuleExcludePatterns(event.target.value)}
            hint="La exclusión gana sobre la inclusión."
          />
        </div>
      </div>

      <Callout tone="info" title="Un lote no borra el destino">
        Para reemplazar una base que ya existe, usá el asistente de a una, que confirma el
        nombre exacto de esa base. Acá, sobre una base existente, solo se pueden copiar datos.
      </Callout>
    </div>
  )
}
