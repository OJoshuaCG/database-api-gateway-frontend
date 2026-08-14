import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  PageHeader,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import type { MigrationSelectResultItem } from '@/lib/contracts'
import { useManagedDatabase } from '../hooks/use-managed-databases'
import { usePurgeSelectResults, useSelectResults } from '../hooks/use-db-migrations'

/**
 * Pantalla de lectura de la captura de resultados de SELECT (api-reference-v9 §3.5/§6, nuevo).
 * No pagina — trae todo de la corrida más reciente de una sola vez. `items: []` con `200` es un
 * estado válido: se distingue "nunca se activó" de "expiró/se purgó" por `capture_selects` (§4.6).
 */
export function SelectResultsPage() {
  const params = useParams()
  const databaseId = Number(params.databaseId)
  const version = params.version ?? ''
  const validId = Number.isFinite(databaseId) && databaseId > 0 && version.length > 0

  const [purgeOpen, setPurgeOpen] = useState(false)

  const db = useManagedDatabase(databaseId, validId)
  const results = useSelectResults(databaseId, version, validId)
  const purge = usePurgeSelectResults(databaseId, version)

  if (!validId) {
    return <ErrorState error={new Error('Identificador de base de datos o versión inválido.')} />
  }
  if (db.isLoading || results.isLoading) return <FullPageSpinner label="Cargando resultados" />
  if (db.isError || !db.data) {
    return <ErrorState error={db.error} onRetry={() => void db.refetch()} />
  }
  if (results.isError || !results.data) {
    return <ErrorState error={results.error} onRetry={() => void results.refetch()} />
  }

  const database = db.data
  const data = results.data
  const backTo = `/managed-databases/${databaseId}/migrations`

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to={backTo} className="text-sm text-muted-foreground hover:text-foreground">
          ← Migraciones de {database.name}
        </Link>
        <PageHeader
          title={`Resultados capturados · ${data.version}`}
          description="Filas de los SELECT capturados en la corrida más reciente de esta versión sobre esta BD. Es una foto de solo lectura, sin paginar ni buscar (§1)."
          actions={
            <Button
              variant="danger"
              onClick={() => setPurgeOpen(true)}
              disabled={data.items.length === 0}
            >
              Purgar ahora
            </Button>
          }
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {database.name} · #{database.id}
          </code>
          <Badge tone={data.capture_selects ? 'info' : 'neutral'}>
            {data.capture_selects ? 'captura activa' : 'captura desactivada'}
          </Badge>
          {data.stale && <Badge tone="warning">SQL cambiado desde esta captura (stale)</Badge>}
        </div>
      </div>

      {/* Banner de durabilidad (§4.3): peso visual de ALERTA, no informativo — filas que pueden
          describir datos que el motor terminó deshaciendo. */}
      {data.durability_warning && (
        <div className="rounded-lg border border-error/40 bg-error/5 p-4 text-sm text-foreground">
          ⚠️ {data.durability_warning}
        </div>
      )}

      {data.missing_indexes.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-xs text-foreground">
          Hay sentencias en el SQL actual que todavía no se ejecutaron/capturaron (posiciones{' '}
          <strong>{data.missing_indexes.join(', ')}</strong>): aplica de nuevo esta versión para
          verlas (§4.5).
        </div>
      )}

      {data.items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title={
                data.capture_selects
                  ? 'La captura expiró o fue purgada'
                  : 'Esta versión nunca activó la captura'
              }
              description={
                data.capture_selects
                  ? 'Esta versión tiene la captura activada, pero no hay filas disponibles: se cumplió el TTL o alguien las purgó a mano (§4.6).'
                  : 'Activa «Capturar resultados de SELECT» en el blueprint y vuelve a aplicar/revertir para generar una captura.'
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {data.items.map((item) => (
            <SelectResultItemCard key={item.statement_index} item={item} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        onConfirm={() => purge.mutate(undefined, { onSuccess: () => setPurgeOpen(false) })}
        title="Purgar resultados capturados"
        description={`Se eliminarán todas las filas capturadas de la versión ${data.version} en «${database.name}». Es irreversible: no hay papelera ni segunda confirmación a nivel API (§3.6).`}
        confirmLabel="Purgar"
        isLoading={purge.isPending}
      />
    </div>
  )
}

function SelectResultItemCard({ item }: { item: MigrationSelectResultItem }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            Statement #{item.statement_index}
          </span>
          <Badge tone={item.direction === 'up' ? 'primary' : 'neutral'}>{item.direction}</Badge>
          <Badge tone={item.status === 'ok' ? 'success' : 'error'}>{item.status}</Badge>
          <DurabilityBadge durability={item.durability} />
          {item.truncated && <Badge tone="warning">truncado</Badge>}
          <span className="ml-auto text-xs text-muted-foreground">
            {formatDateTime(item.captured_at)}
          </span>
        </div>

        <code className="whitespace-pre-wrap break-all rounded bg-surface-muted p-2 text-xs text-muted-foreground">
          {item.sql}
        </code>

        {item.durability === 'rolled_back' && (
          <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">
            Estos datos vienen de un <strong>SELECT dentro de una transacción que el motor
            deshizo</strong> (la migración falló y revirtió). Son reales para diagnosticar el
            fallo, pero puede que las filas ya NO existan en la BD destino (§4.3).
          </p>
        )}

        {item.status === 'error' ? (
          <p className="rounded-lg border border-error/40 bg-error/5 p-2 text-xs text-error">
            {item.error ?? 'La captura de este statement falló.'}
          </p>
        ) : item.columns.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin columnas.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  {item.columns.map((column, columnIndex) => (
                    <th key={columnIndex} className="px-2 py-1.5 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {item.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {/* `rows` es posicional (§7): rows[i][j] ↔ columns[j], NUNCA objetos con clave. */}
                    {item.columns.map((_, columnIndex) => (
                      <td key={columnIndex} className="px-2 py-1.5 text-foreground">
                        {formatCell(row[columnIndex])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{item.row_count} fila(s)</span>
          <span>{item.payload_bytes} bytes</span>
          {item.truncated && (
            <span className="text-warning">
              hay más filas/datos de los que se muestran (límite de captura alcanzado)
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DurabilityBadge({ durability }: { durability: MigrationSelectResultItem['durability'] }) {
  if (durability === 'committed') return <Badge tone="success">committed</Badge>
  if (durability === 'rolled_back') return <Badge tone="warning">rolled back</Badge>
  return <Badge tone="neutral">unknown</Badge>
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
