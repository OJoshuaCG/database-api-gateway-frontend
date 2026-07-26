import { useState } from 'react'
import { Badge, Button, Input, Modal, Switch } from '@/components/ui'
import type { ApplyAllResult, OnFailureMode } from '@/lib/contracts'
import { useApplyAllMigrations } from '../hooks/use-model-migrations'
import { OnFailureSelect } from './OnFailureSelect'

interface ApplyAllDialogProps {
  modelId: number
  modelName?: string
  open: boolean
  onClose: () => void
}

/** Aplica las migraciones del blueprint a todas sus BDs (§8). Síncrono, acotado por `max_databases`. */
export function ApplyAllDialog({ modelId, modelName, open, onClose }: ApplyAllDialogProps) {
  const [maxDatabases, setMaxDatabases] = useState(10)
  const [force, setForce] = useState(false)
  // `on_failure` (§9): manejo del fallo a mitad de una migración multi-sentencia por BD.
  const [onFailure, setOnFailure] = useState<OnFailureMode>('auto')
  const [result, setResult] = useState<ApplyAllResult | null>(null)
  const [wasDryRun, setWasDryRun] = useState(false)
  const applyAll = useApplyAllMigrations(modelId)

  const handleClose = () => {
    setResult(null)
    onClose()
  }

  const run = (dryRun: boolean) => {
    setWasDryRun(dryRun)
    applyAll.mutate(
      { maxDatabases, force, dryRun, onFailure },
      { onSuccess: (data) => setResult(data) },
    )
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Aplicar a todas las BDs"
      description={
        modelName
          ? `Aplica las migraciones pendientes de «${modelName}» a las BDs que lo replican.`
          : undefined
      }
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Máx. BDs por llamada"
            type="number"
            min={1}
            max={100}
            value={maxDatabases}
            onChange={(event) => setMaxDatabases(Number(event.target.value))}
            hint="1–100 (procesamiento síncrono)."
          />
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

        <div className="flex gap-2">
          <Button variant="outline" isLoading={applyAll.isPending} onClick={() => run(true)}>
            Previsualizar (dry-run)
          </Button>
          <Button isLoading={applyAll.isPending} onClick={() => run(false)}>
            Aplicar a todas 🔌
          </Button>
        </div>

        {result && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {wasDryRun ? 'Plan (sin aplicar)' : 'Resultado'} · {result.processed} de{' '}
              {result.total_databases} BD(s) procesada(s)
            </p>
            <ul className="flex max-h-64 flex-col divide-y divide-border overflow-auto rounded-lg border border-border">
              {result.results.map((item) => (
                <li key={item.managed_database_id} className="flex flex-col gap-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {item.database_name}
                    </span>
                    <Badge tone={item.ok ? 'success' : 'error'}>{item.ok ? 'OK' : 'Error'}</Badge>
                  </div>
                  {item.applied && item.applied.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Aplicadas:{' '}
                      {item.applied
                        .map((a) => {
                          // Detalle de checkpoint/reconciliación (§9), si el backend lo incluye.
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
                  {item.error && <span className="text-xs text-error">{item.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
