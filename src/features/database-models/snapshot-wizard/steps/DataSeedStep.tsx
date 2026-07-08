import { Badge, Button, Checkbox, Spinner } from '@/components/ui'
import { MAX_DATA_TABLES, type OnOversize } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { HIGH_ROW_ESTIMATE } from '../logic'
import type { SnapshotWizard } from '../use-snapshot-wizard'

const OVERSIZE_OPTIONS: { value: OnOversize; label: string }[] = [
  { value: 'skip', label: 'Omitir las tablas que excedan el guardrail y reportarlas' },
  { value: 'error', label: 'Fallar la creación si alguna excede el guardrail' },
]

/** Vista 5b — datos-semilla de catálogos (opcional). */
export function DataSeedStep({ wizard }: { wizard: SnapshotWizard }) {
  const statsLoaded = wizard.snapshot.data?.table_stats != null
  const loadingStats = wizard.includeDataStats && !statsLoaded && wizard.snapshot.isFetching
  const candidates = wizard.dataCandidateList
  const atLimit = wizard.dataCount >= MAX_DATA_TABLES

  const footer = (
    <div className="flex justify-between gap-2 border-t border-border pt-4">
      <Button variant="ghost" onClick={wizard.back}>
        ← Atrás
      </Button>
      <Button onClick={wizard.next}>
        {wizard.dataCount > 0 ? 'Continuar →' : 'Continuar sin datos →'}
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Datos-semilla (opcional)</h2>
        <p className="text-sm text-muted-foreground">
          Solo catálogos pequeños (tipos, estados, monedas…). No es para datos masivos. Requieren
          clave primaria y rigen guardrails de tamaño (filas/bytes/nº de tablas).
        </p>
      </div>

      {!statsLoaded ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">
            Para elegir catálogos hay que leer estadísticas por tabla (una consulta extra por tabla).
          </p>
          <Button
            variant="outline"
            onClick={() => wizard.setIncludeDataStats(true)}
            isLoading={loadingStats}
          >
            Cargar estadísticas
          </Button>
        </div>
      ) : loadingStats ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Leyendo estadísticas por tabla…
        </div>
      ) : candidates.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-muted p-4 text-sm text-muted-foreground">
          No hay tablas elegibles para datos-semilla (ninguna con estructura incluida y clave
          primaria). Puedes continuar sin datos.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Seleccionadas: <strong className="text-foreground">{wizard.dataCount}</strong> / máx{' '}
              {MAX_DATA_TABLES}
            </span>
            {atLimit && <Badge tone="warning">Límite de tablas alcanzado</Badge>}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 p-2" />
                  <th className="p-2">Tabla</th>
                  <th className="p-2 text-right">Filas (est.)</th>
                  <th className="p-2">PK</th>
                  <th className="p-2">Modo</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => {
                  const selected = candidate.table in wizard.dataModes
                  const disabled = !candidate.hasPrimaryKey || (!selected && atLimit)
                  return (
                    <tr key={candidate.table} className="border-t border-border">
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={selected}
                          disabled={disabled}
                          onChange={() => wizard.toggleDataTable(candidate.table)}
                          aria-label={`Seleccionar ${candidate.table}`}
                          title={!candidate.hasPrimaryKey ? 'Sin PK: no puede sembrar datos' : undefined}
                        />
                      </td>
                      <td className="p-2">
                        <code className="font-mono text-xs text-foreground">{candidate.table}</code>
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        <span className={cn(candidate.estimatedRows >= HIGH_ROW_ESTIMATE && 'text-warning')}>
                          {candidate.estimatedRows.toLocaleString('es')}
                        </span>
                        {candidate.estimatedRows >= HIGH_ROW_ESTIMATE && (
                          <span className="ml-1 text-xs text-warning" title="Puede superar el guardrail y omitirse">
                            ⚠
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        {candidate.hasPrimaryKey ? (
                          <Badge tone="success">sí</Badge>
                        ) : (
                          <Badge tone="neutral">no</Badge>
                        )}
                      </td>
                      <td className="p-2">
                        <select
                          value={wizard.dataModes[candidate.table] ?? 'upsert'}
                          disabled={!selected}
                          onChange={(event) =>
                            wizard.setDataMode(
                              candidate.table,
                              event.target.value as 'upsert' | 'insert_ignore',
                            )
                          }
                          className="h-8 rounded-md border border-input bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                          aria-label={`Modo de siembra de ${candidate.table}`}
                        >
                          <option value="upsert">upsert</option>
                          <option value="insert_ignore">insert_ignore</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-foreground">Si una tabla excede el guardrail</legend>
            {OVERSIZE_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name="on-oversize"
                  className="accent-primary"
                  checked={wizard.onOversize === option.value}
                  onChange={() => wizard.setOnOversize(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>

          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
            <Checkbox
              label="Confirmo el rollback por PK (DELETE) de las versiones de datos"
              hint="Al revertir una versión de datos se ejecutará DELETE por PK sobre las filas sembradas. Sin marcar, el rollback queda solo como sugerencia (no ejecutable)."
              checked={wizard.confirmDataRollback}
              onChange={(event) => wizard.setConfirmDataRollback(event.target.checked)}
            />
          </div>
        </>
      )}

      {footer}
    </div>
  )
}
