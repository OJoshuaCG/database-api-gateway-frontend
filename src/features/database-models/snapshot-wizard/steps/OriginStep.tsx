import { Button, Combobox, EmptyState, ErrorState } from '@/components/ui'
import type { ServerOut } from '@/lib/contracts'
import type { SnapshotWizard } from '../use-snapshot-wizard'

/** Vista 1 — elige servidor + BD de origen y dispara el preview. */
export function OriginStep({ wizard }: { wizard: SnapshotWizard }) {
  const { databases } = wizard
  const canContinue = Boolean(wizard.serverId) && Boolean(wizard.database)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Origen del snapshot</h2>
        <p className="text-sm text-muted-foreground">
          Elige de qué servidor y base de datos se tomará la estructura. El gateway leerá el motor
          en vivo (solo lectura); puede tardar en BDs grandes.
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

          {wizard.serverId && databases.isError ? (
            <ErrorState
              error={databases.error}
              onRetry={() => void databases.refetch()}
              title="No se pudieron listar las bases de datos"
            />
          ) : wizard.serverId && !databases.isLoading && (databases.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="Sin bases de datos"
              description="Este servidor no tiene bases de datos accesibles."
            />
          ) : (
            <Combobox<string>
              items={databases.data ?? []}
              value={wizard.database}
              onChange={wizard.setDatabase}
              itemToString={(d) => d}
              itemToKey={(d) => d}
              label="Base de datos"
              placeholder={wizard.serverId ? 'Selecciona la BD' : 'Elige un servidor primero'}
              isLoading={databases.isLoading}
              disabled={!wizard.serverId}
              required
            />
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button onClick={wizard.next} disabled={!canContinue}>
          Ver estructura →
        </Button>
      </div>
    </div>
  )
}
