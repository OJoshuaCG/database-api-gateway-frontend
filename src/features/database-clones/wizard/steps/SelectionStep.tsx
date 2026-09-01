import {
  Badge,
  Button,
  Callout,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  RadioCardGroup,
  Spinner,
} from '@/components/ui'
import type { CloneObjectType } from '@/lib/contracts'
import {
  CLONE_OBJECT_TYPE_LABELS,
  cloneRefKey,
  groupObjectsByType,
  portabilityTone,
  type CloneSelectionKind,
} from '../logic'
import type { DatabaseCloneWizard } from '../use-database-clone-wizard'

/**
 * Vista 3 (solo clon parcial) — qué se clona, en cualquiera de los DOS idiomas que acepta el
 * contrato y que son mutuamente excluyentes:
 *
 * - **Marcar a mano**: refs exactas, con cierre de dependencias en vivo (marcar un objeto
 *   autoritativo arrastra lo necesario; las referencias advisory se resaltan pero no se agregan
 *   solas). Es el modo preciso, y ahora con filtro por tipo y acciones masivas — enumerar 200
 *   tablas de a una era el motivo por el que este paso no se usaba.
 * - **Por regla**: tipos + patrones, que el backend resuelve contra el catálogo del origen. Es
 *   el modo que hace de «todas las tablas» un solo gesto, y el único que no envejece: una tabla
 *   creada entre el plan y la ejecución entra sola.
 *
 * El conteo del modo por regla se calcula en el cliente y es ORIENTATIVO: el plan autoritativo
 * lo arma el backend en `preview`, que además cierra dependencias por FK.
 */
const SELECTION_KIND_OPTIONS = [
  {
    value: 'manual' as const,
    label: 'Marcar a mano',
    hint: 'Elegís objeto por objeto. Las dependencias por FK/trigger se agregan solas.',
  },
  {
    value: 'rule' as const,
    label: 'Por regla',
    hint: 'Describís qué copiar con tipos y patrones. No envejece si el origen cambia.',
  },
]

/** Cuántos nombres del match se muestran antes de resumir el resto. */
const RULE_PREVIEW_LIMIT = 15

export function SelectionStep({ wizard }: { wizard: DatabaseCloneWizard }) {
  const { objects, closure, selectionKind } = wizard

  if (objects.isLoading && !objects.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Fotografiando el origen…
      </div>
    )
  }
  if (objects.isError && !objects.data) {
    return <ErrorState error={objects.error} title="No se pudo cargar el inventario del origen" />
  }
  if (!objects.data) return null
  if (objects.data.objects.length === 0) {
    return <EmptyState title="Sin objetos" description="El origen no tiene objetos para clonar." />
  }

  const addedKeys = new Set((closure.data?.added ?? []).map(cloneRefKey))
  const groups = groupObjectsByType(wizard.visibleObjects)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Selecciona qué clonar</h2>
        <p className="text-sm text-muted-foreground">
          Los objetos con FK/trigger necesarios se agregan solos; las sugerencias se resaltan pero
          no se marcan automáticamente.
        </p>
      </div>

      {objects.data.scope_note && (
        <p className="rounded-lg bg-surface-muted p-3 text-xs text-muted-foreground">
          {objects.data.scope_note}
        </p>
      )}
      {objects.data.cross_engine && (
        <Callout tone="warning" title="Clon cross-engine">
          Los objetos marcados como no portables se omitirán del clon.
        </Callout>
      )}

      <RadioCardGroup<CloneSelectionKind>
        title="Cómo elegir los objetos"
        options={SELECTION_KIND_OPTIONS}
        value={selectionKind}
        onChange={wizard.setSelectionKind}
        columns={2}
        name="clone-selection-kind"
      />

      {selectionKind === 'manual' ? (
        <ManualSelection wizard={wizard} groups={groups} addedKeys={addedKeys} />
      ) : (
        <RuleSelection wizard={wizard} />
      )}
    </div>
  )
}

// ── Modo manual ───────────────────────────────────────────────────────────────────
function ManualSelection({
  wizard,
  groups,
  addedKeys,
}: {
  wizard: DatabaseCloneWizard
  groups: { objectType: CloneObjectType; objects: DatabaseCloneWizard['visibleObjects'] }[]
  addedKeys: Set<string>
}) {
  const { checkedSelection, closure } = wizard

  return (
    <div className="flex flex-col gap-4">
      <TypeFilterChips
        label="Mostrar solo"
        available={wizard.availableTypes}
        selected={wizard.manualTypeFilter}
        onToggle={wizard.toggleManualTypeFilter}
        emptyHint="todos los tipos"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Seleccionados: <strong className="text-foreground">{wizard.visibleSelectedCount}</strong>{' '}
          de {wizard.visibleSelectableCount}
          {wizard.manualTypeFilter.length > 0 && ' (en los tipos mostrados)'}
          {checkedSelection.size !== wizard.visibleSelectedCount &&
            ` · ${checkedSelection.size} en total`}
        </p>
        {/*
          Las tres acciones operan solo sobre lo VISIBLE y parten de la selección actual: con un
          filtro puesto, «Todo» agrega los tipos mostrados sin descartar lo marcado en el resto.
        */}
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => wizard.bulkSelect('all')}>
            Todo
          </Button>
          <Button variant="ghost" size="sm" onClick={() => wizard.bulkSelect('none')}>
            Ninguno
          </Button>
          <Button variant="ghost" size="sm" onClick={() => wizard.bulkSelect('invert')}>
            Invertir
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="Sin objetos de ese tipo"
          description="Quita el filtro para ver el resto del inventario."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div
              key={group.objectType}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {CLONE_OBJECT_TYPE_LABELS[group.objectType]}
              </p>
              <div className="flex flex-col gap-1.5">
                {group.objects.map((object) => {
                  const ref = { object_type: object.object_type, name: object.name }
                  const key = cloneRefKey(ref)
                  const isAdded = addedKeys.has(key)
                  const isChecked = isAdded || checkedSelection.has(key)
                  return (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <Checkbox
                        label={object.name}
                        checked={isChecked}
                        disabled={!object.portable || isAdded}
                        onChange={() => wizard.toggleObject(ref)}
                      />
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isAdded && <Badge tone="primary">agregado por dependencia</Badge>}
                        <Badge tone={portabilityTone(object)}>
                          {!object.portable
                            ? 'no portable'
                            : object.portability_reason
                              ? 'best-effort'
                              : 'portable'}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {(closure.isStale || closure.isFetching) && (
        <p className="text-xs text-muted-foreground">⏳ Resolviendo dependencias…</p>
      )}
      {closure.isError && (
        <ErrorState error={closure.error} title="No se pudo resolver el cierre de dependencias" />
      )}
      {closure.data && closure.data.advisory.length > 0 && (
        <Callout tone="warning" title="Sugerencias (no agregadas automáticamente)">
          <div className="flex flex-col gap-1">
            {closure.data.advisory.map((edge, index) => (
              <p key={index} className="text-xs text-muted-foreground">
                {edge.from_type} <strong>{edge.from_name}</strong> probablemente también necesite{' '}
                <strong>{edge.to_name}</strong> ({edge.to_type}).
              </p>
            ))}
          </div>
        </Callout>
      )}
      {closure.data && closure.data.warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-3 text-xs text-muted-foreground">
          {closure.data.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Modo por regla ────────────────────────────────────────────────────────────────
function RuleSelection({ wizard }: { wizard: DatabaseCloneWizard }) {
  const { rule, ruleMatches } = wizard
  const shown = ruleMatches.slice(0, RULE_PREVIEW_LIMIT)
  const rest = ruleMatches.length - shown.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => wizard.setRuleTypes(['table'])}>
          Solo tablas
        </Button>
        <Button variant="outline" size="sm" onClick={() => wizard.setRuleTypes([])}>
          Todos los tipos
        </Button>
      </div>

      <TypeFilterChips
        label="Tipos de objeto"
        available={wizard.availableTypes}
        selected={rule.types}
        onToggle={wizard.toggleRuleType}
        emptyHint="todos los tipos del origen"
      />

      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="Incluir solo los que coincidan"
          placeholder="fact_*, dim_*"
          value={rule.includePatterns}
          onChange={(event) => wizard.setRuleIncludePatterns(event.target.value)}
          hint="Patrones separados por coma o espacio. * y ? comodines, sensible a mayúsculas."
        />
        <Input
          label="Excluir los que coincidan"
          placeholder="log_*, tmp_*"
          value={rule.excludePatterns}
          onChange={(event) => wizard.setRuleExcludePatterns(event.target.value)}
          hint="La exclusión gana sobre la inclusión."
        />
      </div>

      {wizard.ruleMatchesEverything ? (
        <Callout tone="info" title="Esta regla no recorta nada">
          Sin tipos ni patrones, la regla selecciona todo el origen — es equivalente a un clon
          completo. Agregá un tipo o un patrón, o volvé atrás y elegí «Clon completo».
        </Callout>
      ) : ruleMatches.length === 0 ? (
        <Callout tone="warning" title="La regla no coincide con ningún objeto">
          Revisá los patrones: se comparan contra los NOMBRES del catálogo del origen, no contra
          SQL, y distinguen mayúsculas de minúsculas.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Coinciden <strong className="text-foreground">{ruleMatches.length}</strong> objetos del
            inventario actual.
          </p>
          <Badge tone="neutral">estimación del cliente</Badge>
        </div>
        {/*
          Es una ayuda visual, no el plan: el backend resuelve la regla contra el catálogo en vivo
          al congelar el plan y además CIERRA las dependencias por FK, así que el preview puede
          incluir tablas que acá no aparecen.
        */}
        <p className="text-xs text-muted-foreground">
          El plan definitivo lo resuelve el servidor en el preview, que además agrega las tablas
          que las FK necesiten.
        </p>
        {shown.length > 0 && (
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {shown.map((object) => (
              <div
                key={`${object.object_type}:${object.name}`}
                className="flex items-center justify-between gap-3"
              >
                <span className="break-all text-sm text-foreground">{object.name}</span>
                <Badge tone="neutral">{CLONE_OBJECT_TYPE_LABELS[object.object_type]}</Badge>
              </div>
            ))}
            {rest > 0 && <p className="text-xs text-muted-foreground">y {rest} más…</p>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Chips de tipo, compartidos por los dos modos ──────────────────────────────────
function TypeFilterChips({
  label,
  available,
  selected,
  onToggle,
  emptyHint,
}: {
  label: string
  available: CloneObjectType[]
  selected: CloneObjectType[]
  onToggle: (type: CloneObjectType) => void
  emptyHint: string
}) {
  if (available.length <= 1) return null

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {selected.length === 0 && (
          <span className="ml-2 font-normal normal-case tracking-normal">({emptyHint})</span>
        )}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {available.map((type) => (
          <Button
            key={type}
            variant={selected.includes(type) ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={selected.includes(type)}
            onClick={() => onToggle(type)}
          >
            {CLONE_OBJECT_TYPE_LABELS[type]}
          </Button>
        ))}
      </div>
    </div>
  )
}
