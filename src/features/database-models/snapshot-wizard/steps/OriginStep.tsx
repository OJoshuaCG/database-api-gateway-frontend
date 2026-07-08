import { Badge, Combobox, EmptyState, ErrorState } from '@/components/ui'
import type { ReconcileDatabaseItem, ReconcileState, ServerOut } from '@/lib/contracts'
import type { SnapshotWizard } from '../use-snapshot-wizard'

const STATE_BADGE: Record<ReconcileState, { tone: 'success' | 'warning' | 'error'; label: string }> =
  {
    managed: { tone: 'success', label: 'gestionada' },
    unmanaged: { tone: 'warning', label: 'sin gestionar' },
    orphan: { tone: 'error', label: 'huérfana' },
  }

/** Vista 1 — elige servidor + BD de origen (descubiertas por reconciliación) y dispara el preview. */
export function OriginStep({ wizard }: { wizard: SnapshotWizard }) {
  const { reconcile } = wizard
  // Las candidatas naturales van primero (sin gestionar), pero se puede fotografiar cualquiera.
  const items = [...wizard.databaseItems].sort((a, b) =>
    a.state === b.state ? a.name.localeCompare(b.name) : a.state === 'unmanaged' ? -1 : 1,
  )
  const selectedDb = items.find((d) => d.name === wizard.database) ?? null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Origen del snapshot</h2>
        <p className="text-sm text-muted-foreground">
          Elige de qué servidor y base de datos se tomará la estructura. El gateway leerá el motor
          en vivo (solo lectura); puede tardar en BDs grandes. Las bases{' '}
          <strong>sin gestionar</strong> son las candidatas naturales a convertir en blueprint.
        </p>
      </div>

      {wizard.presetLocked ? (
        <p className="rounded-lg bg-surface-muted p-3 text-sm text-muted-foreground">
          Origen: servidor <strong>#{wizard.serverId}</strong> · BD{' '}
          <code className="font-mono">{wizard.database}</code>
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Combobox<ServerOut>
            items={wizard.servers.data ?? []}
            value={wizard.server}
            onChange={wizard.setServer}
            itemToString={(s) => s.name}
            itemToKey={(s) => s.id}
            label="Servidor destino"
            placeholder="Selecciona el servidor de origen"
            isLoading={wizard.servers.isLoading}
            required
          />

          {wizard.serverId && reconcile.isError ? (
            <ErrorState
              error={reconcile.error}
              onRetry={() => void reconcile.refetch()}
              title="No se pudieron listar las bases de datos"
            />
          ) : wizard.serverId && !reconcile.isLoading && items.length === 0 ? (
            <EmptyState
              title="Sin bases de datos"
              description="Este servidor no tiene bases de datos accesibles para fotografiar."
            />
          ) : (
            <Combobox<ReconcileDatabaseItem>
              items={items}
              value={selectedDb}
              onChange={(item) => wizard.setDatabase(item?.name ?? null)}
              itemToString={(d) => d.name}
              itemToKey={(d) => d.name}
              renderItem={(d) => (
                <span className="flex items-center justify-between gap-2">
                  <span>{d.name}</span>
                  <Badge tone={STATE_BADGE[d.state].tone}>{STATE_BADGE[d.state].label}</Badge>
                </span>
              )}
              label="Base de datos"
              placeholder={wizard.serverId ? 'Selecciona la BD' : 'Elige un servidor primero'}
              isLoading={reconcile.isLoading}
              disabled={!wizard.serverId}
              required
            />
          )}

          {selectedDb && selectedDb.state === 'managed' && (
            <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
              «{selectedDb.name}» ya está gestionada por el gateway. Puedes fotografiarla igualmente
              para derivar un blueprint, pero no es el caso habitual.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
