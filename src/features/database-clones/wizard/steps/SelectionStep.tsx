import { Badge, Checkbox, EmptyState, ErrorState, Spinner } from '@/components/ui'
import { CLONE_OBJECT_TYPE_LABELS, cloneRefKey, groupObjectsByType, portabilityTone } from '../logic'
import type { DatabaseCloneWizard } from '../use-database-clone-wizard'

/**
 * Vista 3 (solo clon parcial) — inventario del origen con portabilidad por objeto + cierre de
 * dependencias en vivo: marcar un objeto autoritativo (FK/trigger) arrastra solo lo necesario;
 * las referencias advisory (vistas/rutinas) se resaltan pero nunca se agregan solas.
 */
export function SelectionStep({ wizard }: { wizard: DatabaseCloneWizard }) {
  const { objects, closure, checkedSelection } = wizard

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
  const groups = groupObjectsByType(objects.data.objects)

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
        <p className="rounded-lg bg-surface-muted p-3 text-xs text-muted-foreground">{objects.data.scope_note}</p>
      )}
      {objects.data.cross_engine && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
          ⚠ Cross-engine: los objetos marcados como no portables se omitirán del clon.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.objectType} className="flex flex-col gap-2 rounded-lg border border-border p-3">
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
                        {!object.portable ? 'no portable' : object.portability_reason ? 'best-effort' : 'portable'}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {(closure.isStale || closure.isFetching) && (
        <p className="text-xs text-muted-foreground">⏳ Resolviendo dependencias…</p>
      )}
      {closure.isError && (
        <ErrorState error={closure.error} title="No se pudo resolver el cierre de dependencias" />
      )}
      {closure.data && closure.data.advisory.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
          <p className="font-medium">Sugerencias (no agregadas automáticamente)</p>
          {closure.data.advisory.map((edge, index) => (
            <p key={index} className="text-xs text-muted-foreground">
              {edge.from_type} <strong>{edge.from_name}</strong> probablemente también necesite{' '}
              <strong>{edge.to_name}</strong> ({edge.to_type}).
            </p>
          ))}
        </div>
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
