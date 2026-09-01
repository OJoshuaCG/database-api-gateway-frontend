import { Badge, Button, Callout, Checkbox, EmptyState, ErrorState, Input, Spinner } from '@/components/ui'
import type { CloneTargetMode } from '@/lib/contracts'
import type { CloneBatchWizard } from '../use-clone-batch-wizard'

/**
 * Paso 2 — qué bases y con qué nombre.
 *
 * Es el paso que da sentido al lote, así que las tres cosas que costaban tiempo están acá:
 * marcar todas de una vez, editar el nombre destino en la misma fila, y aplicar un
 * prefijo/sufijo a todos los nombres de un golpe.
 */
export function DatabasesStep({ wizard }: { wizard: CloneBatchWizard }) {
  const { plan, sourceReconcile, sourceDatabases, targetNames, duplicates, needDataOnly } = wizard

  if (plan.sourceServerId == null) {
    return (
      <EmptyState
        title="Falta el servidor origen"
        description="Volvé al paso anterior y elegí de qué servidor salen las bases."
      />
    )
  }
  if (sourceReconcile.isLoading && !sourceReconcile.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Leyendo las bases del origen…
      </div>
    )
  }
  if (sourceReconcile.isError && !sourceReconcile.data) {
    return (
      <ErrorState
        error={sourceReconcile.error}
        title="No se pudieron listar las bases del servidor origen"
      />
    )
  }
  if (sourceDatabases.length === 0) {
    return (
      <EmptyState
        title="El servidor no tiene bases para clonar"
        description="No se encontró ninguna base de datos de usuario en el origen."
      />
    )
  }

  const seleccionadas = plan.rows.size
  const necesitanDataOnly = new Set(needDataOnly)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Qué bases se copian</h2>
        <p className="text-sm text-muted-foreground">
          El nombre en el destino se puede cambiar en cada fila.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Seleccionadas: <strong className="text-foreground">{seleccionadas}</strong> de{' '}
          {sourceDatabases.length}
        </p>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => wizard.selectAll(true)}>
            Todas
          </Button>
          <Button variant="ghost" size="sm" onClick={() => wizard.selectAll(false)}>
            Ninguna
          </Button>
        </div>
      </div>

      {/*
        Renombrado masivo. Se aplica siempre sobre el nombre de ORIGEN, no sobre el actual: de
        lo contrario, tocar el botón dos veces produce `stg_stg_ventas`.
      */}
      {seleccionadas > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
          <div className="min-w-40 flex-1">
            <Input
              label="Prefijo"
              placeholder="stg_"
              value={wizard.prefix}
              onChange={(event) => wizard.setPrefix(event.target.value)}
            />
          </div>
          <div className="min-w-40 flex-1">
            <Input
              label="Sufijo"
              placeholder="_copia"
              value={wizard.suffix}
              onChange={(event) => wizard.setSuffix(event.target.value)}
            />
          </div>
          <Button variant="outline" onClick={wizard.applyAffix}>
            Aplicar a las {seleccionadas} seleccionadas
          </Button>
        </div>
      )}

      {duplicates.size > 0 && (
        <Callout tone="danger" title="Hay nombres de destino repetidos">
          {[...duplicates].join(', ')} — dos bases no pueden escribir en el mismo destino: una
          pisaría a la otra sin que nada fallara.
        </Callout>
      )}
      {needDataOnly.length > 0 && (
        <Callout tone="danger" title="Estas filas usan una base existente">
          {needDataOnly.join(', ')} — sobre una base que ya existe el lote solo puede copiar
          datos, porque no borra y no puede crear objetos que ya están. Cambiá «qué copiar» a
          «solo datos», o poné otro nombre de destino.
        </Callout>
      )}

      <div className="flex flex-col gap-2">
        {sourceDatabases.map((db) => {
          const fila = plan.rows.get(db.name)
          const marcada = fila != null
          const destino = fila?.targetDatabaseName ?? db.name
          const yaExiste = targetNames.has(destino.trim())
          return (
            <div
              key={db.name}
              className="flex flex-col gap-2 rounded-lg border border-border p-3 md:flex-row md:items-center md:gap-3"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Checkbox
                  label={db.name}
                  checked={marcada}
                  onChange={() => wizard.toggleDatabase(db)}
                />
                {db.state === 'managed' && <Badge tone="primary">en inventario</Badge>}
                {db.state === 'unmanaged' && <Badge tone="neutral">sin registrar</Badge>}
              </div>

              {marcada && (
                <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label={`Nombre en el destino para ${db.name}`}
                      value={destino}
                      onChange={(event) => wizard.setRowTargetName(db.name, event.target.value)}
                      error={
                        duplicates.has(destino.trim())
                          ? 'Repetido'
                          : destino.trim()
                            ? undefined
                            : 'Requerido'
                      }
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {yaExiste && <Badge tone="warning">ya existe</Badge>}
                    <ModeToggle
                      value={fila.targetMode}
                      invalid={necesitanDataOnly.has(destino)}
                      onChange={(mode) => wizard.setRowTargetMode(db.name, mode)}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Crear la base o usar una que ya está. Sin tercera opción: el lote no borra. */
function ModeToggle({
  value,
  invalid,
  onChange,
}: {
  value: CloneTargetMode
  invalid: boolean
  onChange: (mode: CloneTargetMode) => void
}) {
  return (
    <div className="flex gap-1">
      <Button
        variant={value === 'new' ? 'primary' : 'ghost'}
        size="sm"
        aria-pressed={value === 'new'}
        onClick={() => onChange('new')}
      >
        Crear
      </Button>
      <Button
        variant={value === 'existing' ? (invalid ? 'danger-soft' : 'primary') : 'ghost'}
        size="sm"
        aria-pressed={value === 'existing'}
        onClick={() => onChange('existing')}
      >
        Usar existente
      </Button>
    </div>
  )
}
