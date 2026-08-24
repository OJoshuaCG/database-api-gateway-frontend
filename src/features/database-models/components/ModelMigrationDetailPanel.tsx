import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CodeBlock,
  EmptyState,
  ErrorState,
  Spinner,
} from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { MigrationBlockReason, ModelMigrationPatch } from '@/lib/contracts'
import { useModelDatabases } from '../hooks/use-database-models'
import { useModelMigration, useUpdateModelMigration } from '../hooks/use-model-migrations'
import { ModelMigrationForm } from './ModelMigrationForm'
import { MigrationSqlView } from './MigrationSqlView'

interface ModelMigrationDetailPanelProps {
  modelId: number
  version: string | null
  /** Versión punta (mayor número) del blueprint, solo para redactar la pista del botón. */
  latestVersion: string | null
  /** Collation de referencia del blueprint, para explicar un COLLATE forzado que difiera. */
  blueprintCollation?: string | null
  onRequestDelete: (version: string) => void
  /** Fix-forward: abre el formulario de nueva migración (cuando el up_sql ya se aplicó). */
  onCreateNewVersion: () => void
}

/**
 * Por qué no se puede eliminar la versión, según el `block_reason` del backend. `not_tip` es el
 * único que no impide editarla.
 */
const DELETE_BLOCK_HINT: Record<
  MigrationBlockReason | 'none',
  (latestVersion: string | null) => string | undefined
> = {
  none: () => undefined,
  applied: () =>
    'Ya se aplicó con éxito en alguna BD: alguna base depende de ella. Crea una migración compensatoria.',
  partial: () =>
    'Tiene una aplicación parcial sin resolver: reconcilia esa BD o completa el apply antes de eliminarla.',
  not_tip: (latestVersion) =>
    `Solo se puede eliminar la última versión${latestVersion ? ` (${latestVersion})` : ''}.`,
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
 *  2) un card con el SQL y, bajo demanda, su edición.
 *
 * **Se abre en modo LECTURA.** Antes montaba el formulario completo para cualquier versión —con
 * sus campos, su «Cancelar» y su «Guardar cambios»— así que navegar entre versiones parecía una
 * invitación a editarlas, incluidas las que el backend iba a rechazar. Ahora editar es un acto
 * explícito, y al entrar en edición los campos que el backend no permite tocar ya nacen
 * bloqueados (`sql_frozen`), en vez de descubrirse al guardar.
 */
export function ModelMigrationDetailPanel({
  modelId,
  version,
  latestVersion,
  blueprintCollation,
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
  // Condicionado a que la versión capture: en el resto no se muestra la lista, y pedirla sería
  // una llamada de más. Comparte clave con la pestaña de estado, así que si ya se cargó allí
  // esto no dispara nada.
  const databases = useModelDatabases(modelId, data?.capture_selects === true)

  const [submitError, setSubmitError] = useState<string | null>(null)
  const [upSqlLocked, setUpSqlLocked] = useState(false)
  const [editing, setEditing] = useState(false)

  // Al cambiar de versión, se descarta el error/bloqueo de la anterior y se vuelve a lectura. Se
  // ajusta el estado en render (patrón recomendado por React) en vez de con un efecto, para no
  // encadenar renders.
  const [trackedVersion, setTrackedVersion] = useState(version)
  if (version !== trackedVersion) {
    setTrackedVersion(version)
    setSubmitError(null)
    setUpSqlLocked(false)
    setEditing(false)
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
  const capturesSelects = data.capture_selects === true
  // El backend decide si se puede borrar y por qué; aquí solo se traduce a texto. Antes la UI
  // recalculaba la regla («¿es la punta?») y se le escapaban las otras dos condiciones.
  const deleteHint = DELETE_BLOCK_HINT[data.block_reason ?? 'none'](latestVersion)

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
              {capturesSelects ? (
                data.reviewed === false ? (
                  <Badge tone="warning">⚠️ Captura sin revisar</Badge>
                ) : (
                  <Badge tone="info">🔒 Captura aprobada</Badge>
                )
              ) : data.reviewed === false ? (
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
              {capturesSelects
                ? 'Esta versión tiene activada la captura de resultados de SELECT y aún no fue revisada: el SQL de arriba guardará filas de la BD destino (cifradas) en el gateway. No se podrá aplicar/revertir/stampear (el backend responde 409) hasta aprobarla.'
                : 'Este baseline se capturó del motor y nace sin revisar: no se podrá aplicar a ninguna BD (el backend responde 409) hasta aprobarlo.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Card de detalles: SQL en lectura y, bajo demanda, edición */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          {editing ? (
            <ModelMigrationForm
              // La `key` incluye el modo: al salir y volver a entrar, el formulario nace de nuevo
              // con los valores del servidor en vez de arrastrar lo que se hubiera tecleado.
              key={`${data.version}-edit`}
              mode="edit"
              modelId={modelId}
              blueprintCollation={blueprintCollation}
              defaultValues={{
                version: data.version,
                name: data.name,
                up_sql: data.up_sql,
                up_sql_mysql: data.up_sql_mysql ?? '',
                up_sql_postgresql: data.up_sql_postgresql ?? '',
                down_sql: data.down_sql ?? data.down_sql_suggested ?? '',
                capture_selects: data.capture_selects ?? false,
              }}
              isSubmitting={update.isPending}
              submitError={submitError}
              // El bloqueo llega del backend ANTES de escribir nada (`sql_frozen`), no después de
              // que un 409 rechace lo ya tecleado. `upSqlLocked` queda como red por si el estado
              // cambió entre la carga y el guardado, o si el backend es anterior a este contrato.
              upSqlLocked={data.sql_frozen || upSqlLocked}
              onCreateNewVersion={onCreateNewVersion}
              onSubmitEdit={handleSubmitEdit}
              onCancel={() => {
                // Salir de edición descarta de verdad: antes esto solo refetcheaba, y como
                // react-hook-form no reinicializa sus `defaultValues`, lo tecleado seguía ahí.
                setEditing(false)
                setSubmitError(null)
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{data.name}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setEditing(true)}
                >
                  Editar
                </Button>
              </div>
              <CodeBlock title="up_sql (base, estilo MySQL)" code={data.up_sql} />
              <CodeBlock
                title="down_sql (rollback)"
                code={data.down_sql ?? data.down_sql_suggested ?? ''}
                emptyLabel="Sin rollback confirmado."
                extra={
                  data.down_sql ? (
                    <Badge tone="success">confirmado</Badge>
                  ) : data.down_sql_suggested ? (
                    <Badge tone="warning">sugerido (sin confirmar)</Badge>
                  ) : null
                }
              />
              {data.sql_frozen && (
                <p className="text-xs text-muted-foreground">
                  El SQL de esta versión está congelado
                  {data.block_reason === 'partial'
                    ? ' por una aplicación parcial sin resolver'
                    : ' porque alguna BD ya la aplicó con éxito'}
                  : al editar podrás cambiar el nombre, el rollback y los overrides, pero no el SQL
                  base.
                </p>
              )}
            </div>
          )}

          {/* Puente que faltaba: una versión con captura decía "🔒 captura aprobada" pero no
              ofrecía ningún camino hacia lo capturado — solo se llegaba entrando a la ficha de
              cada BD. No se consulta nada por adelantado: la pantalla de destino ya muestra
              vacío si esa BD no tiene capturas de esta versión (el backend no da error). */}
          {capturesSelects && (databases.data?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <span className="text-sm font-medium text-foreground">Resultados capturados</span>
              <p className="text-xs text-muted-foreground">
                Solo se conserva la corrida más reciente por BD, y caduca sola.
              </p>
              <div className="flex flex-wrap gap-2">
                {(databases.data ?? []).map((db) => (
                  <Link
                    key={db.id}
                    to={`/managed-databases/${db.id}/migrations/${data.version}/select-results`}
                    className="rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-primary/10"
                  >
                    {db.name} →
                  </Link>
                ))}
              </div>
            </div>
          )}

          <details className="rounded-lg border border-border p-3" open>
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              SQL traducido por motor (referencia)
            </summary>
            <div className="mt-3">
              <MigrationSqlView migration={data} />
            </div>
          </details>

          <div className="flex justify-end border-t border-border pt-3">
            <span title={deleteHint} className={data.deletable ? undefined : 'cursor-not-allowed'}>
              <Button
                variant="ghost"
                size="sm"
                disabled={!data.deletable}
                onClick={() => onRequestDelete(data.version)}
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
