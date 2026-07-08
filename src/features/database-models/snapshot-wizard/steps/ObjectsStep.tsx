import { useMemo, useState } from 'react'
import { Badge, Button } from '@/components/ui'
import { type DumpObjectType } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { objectKey, OBJECT_TYPE_LABELS, summarizeCounts, TYPE_ORDER } from '../logic'
import type { TypeSelectionMode } from '../logic'
import type { SnapshotWizard } from '../use-snapshot-wizard'

const MODE_OPTIONS: { value: TypeSelectionMode; label: string; hint: string }[] = [
  { value: 'all', label: 'Incluir todo', hint: 'Captura todos los objetos del snapshot.' },
  { value: 'include', label: 'Solo estos tipos', hint: 'Restringe a los tipos seleccionados.' },
  { value: 'exclude', label: 'Excluir estos tipos', hint: 'Quita los tipos seleccionados.' },
]

/** Vista 3 — acota qué objetos entran por tipo y por objeto concreto. */
export function ObjectsStep({ wizard }: { wizard: SnapshotWizard }) {
  const { selection } = wizard
  const [showFine, setShowFine] = useState(false)
  const snapshotData = wizard.snapshot.data
  const statements = useMemo(() => snapshotData?.statements ?? [], [snapshotData])

  // Objetos que pasan el filtro por tipo (antes de la deselección fina) para el ajuste por objeto.
  const typeFiltered = useMemo(() => {
    const typeSet = new Set(selection.types)
    return statements.filter((s) => {
      if (selection.typeMode === 'include') return typeSet.has(s.object_type)
      if (selection.typeMode === 'exclude') return !typeSet.has(s.object_type)
      return true
    })
  }, [statements, selection])

  const grouped = useMemo(() => {
    const map = new Map<DumpObjectType, typeof statements>()
    for (const stmt of typeFiltered) {
      const list = map.get(stmt.object_type) ?? []
      list.push(stmt)
      map.set(stmt.object_type, list)
    }
    return TYPE_ORDER.filter((t) => map.has(t)).map((t) => [t, map.get(t)!] as const)
  }, [typeFiltered])

  const excluded = new Set(selection.excludedObjectKeys)
  const selectedCount = wizard.selectedStatements.length
  const canContinue = selectedCount > 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Selección de objetos</h2>
        <p className="text-sm text-muted-foreground">
          Elige qué objetos entran al blueprint. Por defecto entran todos.
        </p>
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-3">
        {MODE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
              selection.typeMode === option.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-surface-muted',
            )}
          >
            <span className="flex items-center gap-2 font-medium text-foreground">
              <input
                type="radio"
                name="type-mode"
                className="accent-primary"
                checked={selection.typeMode === option.value}
                onChange={() => wizard.setTypeMode(option.value)}
              />
              {option.label}
            </span>
            <span className="text-xs text-muted-foreground">{option.hint}</span>
          </label>
        ))}
      </fieldset>

      {selection.typeMode !== 'all' && (
        <div className="flex flex-wrap gap-2">
          {wizard.presentTypes.map((type) => {
            const active = selection.types.includes(type)
            return (
              <button
                key={type}
                type="button"
                onClick={() => wizard.toggleType(type)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-surface-muted',
                )}
              >
                {OBJECT_TYPE_LABELS[type]}
              </button>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={wizard.applyPortableShortcut}
        className="self-start rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface-muted"
      >
        🔓 Excluir rutinas y triggers → baseline portable
      </button>

      <div>
        <button
          type="button"
          onClick={() => setShowFine((v) => !v)}
          className="text-sm font-medium text-primary hover:underline"
        >
          {showFine ? 'Ocultar' : 'Mostrar'} ajuste fino por objeto
        </button>
        {showFine && (
          <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-auto rounded-lg border border-border p-3">
            {grouped.map(([type, list]) => (
              <div key={type} className="flex flex-col gap-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {OBJECT_TYPE_LABELS[type]}
                </p>
                {list.map((stmt) => {
                  const key = objectKey(stmt)
                  return (
                    <label key={key} className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={!excluded.has(key)}
                        onChange={() => wizard.toggleObjectExcluded(key)}
                      />
                      <code className="font-mono text-xs">{stmt.name}</code>
                    </label>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-muted p-3 text-sm">
        <span className="text-foreground">Quedan seleccionados: {summarizeCounts(wizard.selectedCounts)}.</span>
        <Badge tone={wizard.schemaPortable ? 'success' : 'warning'}>
          {wizard.schemaPortable ? 'Selección portable' : 'No portable'}
        </Badge>
      </div>

      {!canContinue && (
        <p className="rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-error">
          La selección excluye todo. Ajusta los filtros para incluir al menos un objeto.
        </p>
      )}

      <div className="flex justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={wizard.back}>
          ← Atrás
        </Button>
        <Button onClick={wizard.next} disabled={!canContinue}>
          Continuar →
        </Button>
      </div>
    </div>
  )
}
