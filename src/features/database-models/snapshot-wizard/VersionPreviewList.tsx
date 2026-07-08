import { Badge } from '@/components/ui'
import { summarizeCounts, type VersionPreview } from './logic'

/** Lista de versiones estimadas, diferenciando `schema` de `data` (Vistas 4/6). */
export function VersionPreviewList({ versions }: { versions: VersionPreview[] }) {
  if (versions.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay versiones que mostrar.</p>
  }
  return (
    <ol className="flex flex-col gap-2">
      {versions.map((version) => {
        const isData = version.kind === 'data'
        return (
          <li
            key={`${version.index}-${version.name}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              <code className="font-mono text-xs text-muted-foreground">
                v{String(version.index).padStart(4, '0')}
              </code>
              {isData ? (
                <span title="Datos-semilla: atados al motor, no se traducen cross-engine.">
                  <Badge tone="warning">🌱 datos</Badge>
                </span>
              ) : (
                <Badge tone="info">🧱 esquema</Badge>
              )}
              <span className="truncate text-foreground">{version.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!isData && (
                <span className="text-xs text-muted-foreground">{summarizeCounts(version.counts)}</span>
              )}
              {!isData && version.hasNonPortable && <Badge tone="warning">no portable</Badge>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
