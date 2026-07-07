import { useState } from 'react'
import { Badge, Button, Card, CardContent, EmptyState, ErrorState, Spinner } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { ModelMigrationPatch, ModelMigrationSummary } from '@/lib/contracts'
import { useModelMigration, useUpdateModelMigration } from '../hooks/use-model-migrations'
import { ModelMigrationForm } from './ModelMigrationForm'
import { MigrationSqlView } from './MigrationSqlView'

interface ModelMigrationDetailPanelProps {
  modelId: number
  version: string | null
  /** Versión punta (mayor número) del blueprint: solo ella se puede eliminar (Cambio 3). */
  latestVersion: string | null
  onRequestDelete: (migration: ModelMigrationSummary) => void
  /** Fix-forward: abre el formulario de nueva migración (cuando el up_sql ya se aplicó). */
  onCreateNewVersion: () => void
}

/**
 * ¿El `409` al editar es del caso A (ya aplicada ⇒ fix-forward, bloquear up_sql)?
 * El caso B (overrides obsoletos) lo previene el formulario, que exige resolver los overrides antes
 * de enviar; por eso basta con descartar los `409` cuyo mensaje habla explícitamente de overrides
 * y tratar el resto como "ya aplicada", sin depender de acertar el texto exacto del backend.
 */
function isAlreadyAppliedConflict(status: number, message: string): boolean {
  return status === 409 && !/override/i.test(message)
}

/**
 * Detalle de la versión seleccionada, en dos cards apiladas a todo el ancho:
 *  1) un card "delgado" con el estado de la versión (badges + aprobación de baseline R1);
 *  2) un card con el SQL traducido y la edición (up_sql/name/down_sql/overrides).
 * El SQL base de una versión ya aplicada con éxito no se edita: el backend responde `409` y la UI
 * bloquea el campo sugiriendo fix-forward (Cambio 2).
 */
export function ModelMigrationDetailPanel({
  modelId,
  version,
  latestVersion,
  onRequestDelete,
  onCreateNewVersion,
}: ModelMigrationDetailPanelProps) {
  const open = version !== null
  const { data, isLoading, isError, error, refetch } = useModelMigration(
    modelId,
    version ?? '',
    open,
  )
  const update = useUpdateModelMigration(modelId)

  const [submitError, setSubmitError] = useState<string | null>(null)
  const [upSqlLocked, setUpSqlLocked] = useState(false)

  // Al cambiar de versión, se descarta el error/bloqueo de la anterior. Se ajusta el estado en
  // render (patrón recomendado por React) en vez de con un efecto, para no encadenar renders.
  const [trackedVersion, setTrackedVersion] = useState(version)
  if (version !== trackedVersion) {
    setTrackedVersion(version)
    setSubmitError(null)
    setUpSqlLocked(false)
  }

  if (!open) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            title="Selecciona una versión"
            description="Elige una migración en el desplegable de arriba para ver su SQL y editarla."
          />
        </CardContent>
      </Card>
    )
  }
  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando versión…
          </div>
        </CardContent>
      </Card>
    )
  }
  if (isError) {
    return (
      <Card>
        <CardContent>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </CardContent>
      </Card>
    )
  }
  if (!data) return null

  const handleSubmitEdit = (body: ModelMigrationPatch) => {
    setSubmitError(null)
    update.mutate(
      { version: data.version, body },
      {
        onSuccess: () => {
          setSubmitError(null)
          setUpSqlLocked(false)
        },
        onError: (err) => {
          const apiError = toApiError(err)
          setSubmitError(apiError.message)
          // 409 caso A: ya aplicada ⇒ bloquear el up_sql; caso B (overrides) ya se resuelve en el form.
          if (isAlreadyAppliedConflict(apiError.status, apiError.message)) {
            setUpSqlLocked(true)
          }
        },
      },
    )
  }

  const approveBaseline = () => {
    update.mutate({ version: data.version, body: { reviewed: true } })
  }

  const needsReview = data.reviewed === false
  const isTip = latestVersion !== null && data.version === latestVersion
  const deleteHint = isTip
    ? undefined
    : `Solo se puede eliminar la última versión${latestVersion ? ` (${latestVersion})` : ''}.`

  return (
    <div className="flex flex-col gap-4">
      {/* Card delgado: estado de la versión */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{data.version}</code>
            <span className="font-medium text-foreground">{data.name}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              {data.is_baseline && <Badge tone="info">baseline</Badge>}
              {data.has_non_portable && (
                <Badge tone="warning">🔒 {data.source_engine ?? 'motor específico'}</Badge>
              )}
              {data.reviewed === false ? (
                <Badge tone="warning">⚠ pendiente de revisión</Badge>
              ) : data.reviewed === true ? (
                <Badge tone="success">revisado</Badge>
              ) : null}
            </span>
            {needsReview && (
              <Button
                size="sm"
                className="ml-auto"
                isLoading={update.isPending}
                onClick={approveBaseline}
              >
                Revisar y aprobar
              </Button>
            )}
          </div>
          {needsReview && (
            <p className="mt-2 text-xs text-muted-foreground">
              Este baseline se capturó del motor y nace sin revisar: no se podrá aplicar a ninguna
              BD (el backend responde <code>409</code>) hasta aprobarlo.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Card de detalles: SQL + edición */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <ModelMigrationForm
            key={data.version}
            mode="edit"
            defaultValues={{
              version: data.version,
              name: data.name,
              up_sql: data.up_sql,
              up_sql_mysql: data.up_sql_mysql ?? '',
              up_sql_postgresql: data.up_sql_postgresql ?? '',
              down_sql: data.down_sql ?? data.down_sql_suggested ?? '',
            }}
            isSubmitting={update.isPending}
            submitError={submitError}
            upSqlLocked={upSqlLocked}
            onCreateNewVersion={onCreateNewVersion}
            onSubmitEdit={handleSubmitEdit}
            onCancel={() => void refetch()}
          />

          <details className="rounded-lg border border-border p-3" open>
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              SQL traducido por motor (referencia)
            </summary>
            <div className="mt-3">
              <MigrationSqlView migration={data} />
            </div>
          </details>

          <div className="flex justify-end border-t border-border pt-3">
            <span title={deleteHint} className={isTip ? undefined : 'cursor-not-allowed'}>
              <Button
                variant="ghost"
                size="sm"
                disabled={!isTip}
                onClick={() =>
                  onRequestDelete({
                    id: data.id,
                    model_id: data.model_id,
                    version: data.version,
                    name: data.name,
                    has_mysql_override: Boolean(data.up_sql_mysql),
                    has_postgresql_override: Boolean(data.up_sql_postgresql),
                    has_rollback: Boolean(data.down_sql),
                    is_baseline: data.is_baseline,
                    has_non_portable: data.has_non_portable,
                    reviewed: data.reviewed,
                    checksum: data.checksum,
                    created_at: data.created_at,
                  })
                }
              >
                Eliminar esta versión
              </Button>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
