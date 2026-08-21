import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Input, Modal, MultiCombobox, RadioCardGroup, Switch } from '@/components/ui'
import {
  PAGINATION,
  type ApplyAllResult,
  type ModelDatabaseStatus,
  type OnFailureMode,
} from '@/lib/contracts'
import { useModelDatabases } from '../hooks/use-database-models'
import { useApplyAllMigrations, useModelMigrations } from '../hooks/use-model-migrations'
import { OnFailureSelect } from './OnFailureSelect'

interface ApplyMigrationsDialogProps {
  modelId: number
  modelName?: string
  open: boolean
  onClose: () => void
  /** Preselección al abrir desde una fila de la tabla de estado. */
  initialTargets?: ModelDatabaseStatus[]
}

type TargetMode = 'all' | 'selection'

const TARGET_OPTIONS = [
  {
    value: 'all' as const,
    label: 'Todas las BDs del blueprint',
    description: 'Hasta el máximo indicado, en orden de id.',
  },
  {
    value: 'selection' as const,
    label: 'Solo las que elija',
    description: 'Para probar en una BD antes de ir a por todas.',
  },
]

/**
 * Aplica las migraciones del blueprint a **los destinos que se elijan** (§8 + v11 §3).
 *
 * Sustituye al antiguo «Aplicar a todas», que solo permitía acotar *cuántas* BDs, nunca
 * *cuáles*: en desarrollo lo normal es probar una versión nueva contra una BD y solo después
 * ir a por el resto, y eso obligaba a salir a la ficha de esa BD.
 *
 * Sigue siendo UNA llamada: el backend acepta `database_ids`, así que elegir destinos no
 * multiplica las peticiones ni consume el rate limit por BD.
 */
export function ApplyMigrationsDialog({
  modelId,
  modelName,
  open,
  onClose,
  initialTargets,
}: ApplyMigrationsDialogProps) {
  const [mode, setMode] = useState<TargetMode>(initialTargets?.length ? 'selection' : 'all')
  const [targets, setTargets] = useState<ModelDatabaseStatus[]>(initialTargets ?? [])
  const [maxDatabases, setMaxDatabases] = useState(10)
  const [force, setForce] = useState(false)
  const [onFailure, setOnFailure] = useState<OnFailureMode>('auto')
  const [allowResultCapture, setAllowResultCapture] = useState(false)
  const [result, setResult] = useState<ApplyAllResult | null>(null)
  const [wasDryRun, setWasDryRun] = useState(false)

  const applyAll = useApplyAllMigrations(modelId)
  const migrations = useModelMigrations(modelId, { page: 1, size: PAGINATION.maxSize }, open)
  // Misma respuesta que alimenta la pestaña de estado: no es una llamada extra.
  const databases = useModelDatabases(modelId, open)

  // Versiones que capturarían: `reviewed` es opcional en el resumen, y tratar el `undefined`
  // como "no candidata" hacía que el interruptor no apareciera nunca contra un backend que no
  // lo devuelve — y entonces el 409 por BD era inevitable.
  const capturing = (migrations.data?.items ?? []).filter(
    (m) => m.capture_selects && m.reviewed !== false,
  )

  const handleClose = () => {
    setResult(null)
    onClose()
  }

  const run = (dryRun: boolean) => {
    setWasDryRun(dryRun)
    applyAll.mutate(
      {
        maxDatabases,
        databaseIds: mode === 'selection' ? targets.map((t) => t.id) : undefined,
        force,
        dryRun,
        onFailure,
        allowResultCapture,
      },
      { onSuccess: (data) => setResult(data) },
    )
  }

  const nothingSelected = mode === 'selection' && targets.length === 0

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Aplicar migraciones"
      description={modelName ? `Aplica las versiones pendientes de «${modelName}».` : undefined}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <RadioCardGroup
          title="Destinos"
          options={TARGET_OPTIONS}
          value={mode}
          onChange={setMode}
          columns={2}
        />

        {mode === 'selection' && (
          <MultiCombobox<ModelDatabaseStatus>
            label="BDs destino"
            items={databases.data ?? []}
            selectedItems={targets}
            onChange={setTargets}
            itemToString={(db) => db.name}
            itemToKey={(db) => db.id}
            renderItem={(db) => (
              <span className="flex w-full items-center gap-2">
                <span className="truncate">{db.name}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <Badge tone={db.pending_count > 0 ? 'warning' : 'success'}>
                    {db.pending_count} pendiente(s)
                  </Badge>
                  {db.has_partial_application && <Badge tone="error">parcial</Badge>}
                </span>
              </span>
            )}
            placeholder="Añadir BD…"
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'all' && (
            <Input
              label="Máx. BDs por llamada"
              type="number"
              min={1}
              max={100}
              value={maxDatabases}
              onChange={(event) => setMaxDatabases(Number(event.target.value))}
              hint="1–100 (procesamiento síncrono)."
            />
          )}
          <div className="flex items-end">
            <Switch
              checked={force}
              onCheckedChange={setForce}
              label="Forzar"
              hint="Override de cuarentena en cada BD."
            />
          </div>
        </div>

        <div className="max-w-sm">
          <OnFailureSelect value={onFailure} onChange={setOnFailure} />
        </div>

        {capturing.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
            <Switch
              checked={allowResultCapture}
              onCheckedChange={setAllowResultCapture}
              label="Permitir captura de resultados"
              hint="Sin este consentimiento, el backend responde 409 en cada BD que lo requiera."
            />
            {/* El consentimiento es POR CORRIDA a propósito (no se recuerda): cada aplicación
                que va a guardar filas de tus BDs en el gateway pide un sí explícito. Lo que sí
                debe estar claro es QUÉ está en juego, que antes no se decía. */}
            <p className="text-xs text-muted-foreground">
              Estas versiones guardarán en el gateway el resultado de sus SELECT, cifrado:{' '}
              <strong>{capturing.map((m) => m.version).join(', ')}</strong>. Se pide en cada corrida
              a propósito. Solo se conserva la corrida más reciente por BD y versión, y caduca sola;
              podrás verlo o purgarlo desde cada BD al terminar.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            isLoading={applyAll.isPending}
            disabled={nothingSelected}
            onClick={() => run(true)}
          >
            Previsualizar (dry-run)
          </Button>
          <Button
            isLoading={applyAll.isPending}
            disabled={nothingSelected}
            onClick={() => run(false)}
          >
            {mode === 'selection' ? `Aplicar a ${targets.length} BD(s) 🔌` : 'Aplicar a todas 🔌'}
          </Button>
        </div>

        {result && <ApplyResult result={result} wasDryRun={wasDryRun} />}
      </div>
    </Modal>
  )
}

function ApplyResult({ result, wasDryRun }: { result: ApplyAllResult; wasDryRun: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {wasDryRun ? 'Plan (sin aplicar)' : 'Resultado'} · {result.processed} de{' '}
        {result.total_databases} BD(s) procesada(s)
      </p>
      <ul className="flex max-h-64 flex-col divide-y divide-border overflow-auto rounded-lg border border-border">
        {result.results.map((item) => {
          // La versión a la que enlazar es la última aplicada de esta BD: es la corrida cuyas
          // capturas siguen guardadas (solo se conserva la más reciente por BD y versión).
          const lastApplied = item.applied?.at(-1)?.version
          return (
            <li key={item.managed_database_id} className="flex flex-col gap-1 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{item.database_name}</span>
                <Badge tone={item.ok ? 'success' : 'error'}>{item.ok ? 'OK' : 'Error'}</Badge>
              </div>
              {item.applied && item.applied.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Aplicadas:{' '}
                  {item.applied
                    .map((a) => {
                      const resumed = a.resumed
                        ? ` (retomada desde sentencia ${a.resumed_from_statement ?? '?'})`
                        : ''
                      const failedAt =
                        a.failed_at_statement_index != null
                          ? ` (falló en sentencia ${a.failed_at_statement_index}${
                              a.statement_total != null ? ` de ${a.statement_total}` : ''
                            })`
                          : ''
                      return `${a.version}${resumed}${failedAt}`
                    })
                    .join(', ')}
                </span>
              )}
              {item.pending_versions && item.pending_versions.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Pendientes: {item.pending_versions.join(', ')}
                </span>
              )}
              {/* Puente que faltaba: desde el blueprint no había forma de llegar a lo
                  capturado; solo se llegaba entrando a la ficha de cada BD. */}
              {item.select_results_available && lastApplied && (
                <Link
                  to={`/managed-databases/${item.managed_database_id}/migrations/${lastApplied}/select-results`}
                  className="text-xs text-primary hover:underline"
                >
                  Ver {item.captured_select_count} resultado(s) capturado(s) →
                </Link>
              )}
              {item.error && <span className="text-xs text-error">{item.error}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
