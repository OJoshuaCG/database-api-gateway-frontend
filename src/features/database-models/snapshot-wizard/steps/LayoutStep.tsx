import { Button } from '@/components/ui'
import type { SnapshotLayout } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { VersionPreviewList } from '../VersionPreviewList'
import type { SnapshotWizard } from '../use-snapshot-wizard'

const LAYOUT_OPTIONS: { value: SnapshotLayout; label: string; hint: string }[] = [
  {
    value: 'single',
    label: 'Todo en una versión',
    hint: 'La versión 0001 contiene todo el esquema. El más simple (comportamiento histórico).',
  },
  {
    value: 'by_class',
    label: 'Una versión por clase',
    hint: 'Tablas → vistas → materializadas → rutinas → triggers → events. Los datos van al final.',
  },
  {
    value: 'manual',
    label: 'Armar versiones a mano',
    hint: 'Compón buckets ordenados de esquema en el siguiente paso.',
  },
]

/** Vista 4 — estrategia de versionado y previsualización estimada. */
export function LayoutStep({ wizard }: { wizard: SnapshotWizard }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Estrategia de versionado</h2>
        <p className="text-sm text-muted-foreground">
          Define cómo se reparten los objetos en versiones. Cada versión nace sin aprobar.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {LAYOUT_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 text-sm transition-colors',
              wizard.layout === option.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-surface-muted',
            )}
          >
            <span className="flex items-center gap-2 font-medium text-foreground">
              <input
                type="radio"
                name="layout"
                className="accent-primary"
                checked={wizard.layout === option.value}
                onChange={() => wizard.setLayout(option.value)}
              />
              {option.label}
            </span>
            <span className="text-xs text-muted-foreground">{option.hint}</span>
          </label>
        ))}
      </div>

      {wizard.layout !== 'manual' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Versiones estimadas</p>
          <VersionPreviewList versions={wizard.versionPreview} />
          <p className="text-xs text-muted-foreground">
            Estimación en cliente: el backend fija la numeración final (oculta clases vacías). Los
            datos-semilla que elijas se añadirán como versiones de datos al final.
          </p>
        </div>
      )}

      {wizard.layout === 'manual' && (
        <p className="rounded-lg bg-surface-muted p-3 text-sm text-muted-foreground">
          En el siguiente paso compondrás las versiones de esquema a mano. Los datos-semilla se
          añaden después, como versiones al final.
        </p>
      )}

      <div className="flex justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={wizard.back}>
          ← Atrás
        </Button>
        <Button onClick={wizard.next}>Continuar →</Button>
      </div>
    </div>
  )
}
