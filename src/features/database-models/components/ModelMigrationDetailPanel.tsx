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
import {
  MIGRATION_ERROR_CODES,
  type MigrationBlockReason,
  type MigrationEditPreviewIn,
  type MigrationEditPreviewOut,
  type ModelMigrationPatch,
} from '@/lib/contracts'
import { useModelDatabases } from '../hooks/use-database-models'
import {
  useModelMigration,
  usePreviewModelMigrationEdit,
  useUpdateModelMigration,
} from '../hooks/use-model-migrations'
import { ModelMigrationForm } from './ModelMigrationForm'
import { MigrationSqlView } from './MigrationSqlView'
import { MigrationFreezePanel } from './MigrationFreezePanel'
import { MigrationEditOverrideDialog } from './MigrationEditOverrideDialog'

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
    'Alguna base de datos está hoy en esta versión o en una posterior. Crea una migración compensatoria.',
  partial: () =>
    'Tiene una aplicación parcial sin resolver: reconcilia esa BD o completa el apply antes de eliminarla.',
  not_tip: (latestVersion) =>
    `Solo se puede eliminar la última versión${latestVersion ? ` (${latestVersion})` : ''}.`,
}

/**
 * Claves de SQL que entran en el checksum del `confirm_token` (api-reference-v15 §3).
 *
 * El checksum se calcula por **presencia de clave**, así que el cuerpo del `edit-preview` y el del
 * `PATCH` tienen que llevar exactamente las mismas: mandar `up_sql_postgresql: null` en uno y
 * omitirlo en el otro cambia el resultado y el token deja de validar (422). Por eso se parte el
 * cuerpo del formulario en dos con estas claves como frontera, en vez de reconstruirlo a mano en
 * cada paso.
 */
const SQL_KEYS = ['up_sql', 'down_sql', 'up_sql_mysql', 'up_sql_postgresql'] as const

function splitPatchBody(body: ModelMigrationPatch): {
  sqlBody: MigrationEditPreviewIn
  restBody: Omit<ModelMigrationPatch, keyof MigrationEditPreviewIn>
} {
  const sqlBody: MigrationEditPreviewIn = {}
  const restBody: Omit<ModelMigrationPatch, keyof MigrationEditPreviewIn> = {}
  for (const [key, value] of Object.entries(body)) {
    if ((SQL_KEYS as readonly string[]).includes(key)) {
      Object.assign(sqlBody, { [key]: value })
    } else {
      Object.assign(restBody, { [key]: value })
    }
  }
  return { sqlBody, restBody }
}

/**
 * Estado del 409 `model_migration.sql_frozen` mientras el panel de bloqueo está en pantalla.
 *
 * `blockingDatabases` viene de `ApiError`, donde `reason` es `string`: `lib/api` no depende de
 * `lib/contracts` a propósito, así que el enum no llega hasta aquí. Se conserva el tipo ancho en
 * vez de estrecharlo con un cast — un motivo nuevo del backend se pinta igual y no rompe nada.
 */
interface FrozenConflict {
  blockingDatabases: { managed_database_id: number; reason: string; current_version?: string }[]
  overrideAvailable: boolean
  requestId?: string
  body: ModelMigrationPatch
}

/**
 * Detalle de la versión seleccionada, en dos cards apiladas a todo el ancho:
 *  1) un card "delgado" con el estado de la versión (badges + aprobación de baseline R1);
 *  2) un card con el SQL y, bajo demanda, su edición.
 *
 * **Se abre en modo LECTURA.** Editar es un acto explícito, y al entrar en edición los campos que
 * el backend no permite tocar ya nacen bloqueados (`sql_frozen`) en vez de descubrirse al guardar.
 *
 * Desde api-reference-v15 el freeze **tiene una salida**: el 409 trae `override_available` y, si
 * es `true`, se ofrece la vía de excepción de dos pasos. El borrador nunca se pierde en el camino
 * — el formulario sigue montado bajo el panel del 409 y bajo el diálogo.
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
  const previewEdit = usePreviewModelMigrationEdit(modelId)
  // Condicionado a que la versión capture: en el resto no se muestra la lista, y pedirla sería
  // una llamada de más. Comparte clave con la pestaña de estado, así que si ya se cargó allí
  // esto no dispara nada.
  const databases = useModelDatabases(modelId, data?.capture_selects === true)

  const [submitError, setSubmitError] = useState<string | null>(null)
  const [upSqlLocked, setUpSqlLocked] = useState(false)
  const [editing, setEditing] = useState(false)
  /** El operador pidió «Editar de todos modos…»: el campo se desbloquea, no se guarda nada aún. */
  const [unlocked, setUnlocked] = useState(false)
  const [frozen, setFrozen] = useState<FrozenConflict | null>(null)
  const [overridePreview, setOverridePreview] = useState<MigrationEditPreviewOut | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Al cambiar de versión se descarta todo el estado de la anterior y se vuelve a lectura. Se
  // ajusta el estado en render (patrón recomendado por React) en vez de con un efecto, para no
  // encadenar renders.
  const [trackedVersion, setTrackedVersion] = useState(version)
  if (version !== trackedVersion) {
    setTrackedVersion(version)
    setSubmitError(null)
    setUpSqlLocked(false)
    setEditing(false)
    setUnlocked(false)
    setFrozen(null)
    setOverridePreview(null)
    setPreviewError(null)
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
    setFrozen(null)
    update.mutate(
      { version: data.version, body },
      {
        onSuccess: () => {
          setSubmitError(null)
          setUpSqlLocked(false)
          setUnlocked(false)
          setEditing(false)
        },
        onError: (err) => {
          const apiError = toApiError(err)
          // Se clasifica por `public_context.code`, NO por la prosa del mensaje. Antes esto era
          // una expresión regular sobre `msg`, que además de frágil no podía distinguir el 409
          // que sí tiene salida (`sql_frozen`) de los que no la tienen.
          if (apiError.code === MIGRATION_ERROR_CODES.sqlFrozen) {
            setUpSqlLocked(true)
            setFrozen({
              blockingDatabases: apiError.blockingDatabases ?? [],
              // `=== true` estricto: ausente o `false` significa backend anterior a v15, y ahí la
              // única salida sigue siendo fix-forward. Asumir lo contrario ofrecería un camino
              // que el backend va a rechazar.
              overrideAvailable: apiError.overrideAvailable === true,
              requestId: apiError.requestId,
              body,
            })
            return
          }
          if (apiError.code === MIGRATION_ERROR_CODES.staleOverrides) {
            const fields = apiError.staleOverrides?.join(', ')
            setSubmitError(
              fields
                ? `Al cambiar el SQL base hay que reenviar corregidos o limpiar estos overrides: ${fields}.`
                : apiError.message,
            )
            return
          }
          if (apiError.code === MIGRATION_ERROR_CODES.partialApplication) {
            // Este 409 NO tiene override, y ofrecérselo por analogía sería inventar una salida:
            // un `resume` posterior interpretaría los índices del checkpoint contra un SQL que no
            // es el que corrió.
            setSubmitError(
              `${apiError.message} Resuelve primero la aplicación a medias; esta versión no tiene vía de excepción.`,
            )
            return
          }
          setSubmitError(apiError.message)
        },
      },
    )
  }

  /** Salida 2 del 409: pide el preview y, con él, abre el flujo de dos pasos. */
  const startOverride = () => {
    if (!frozen) return
    setPreviewError(null)
    const { sqlBody } = splitPatchBody(frozen.body)
    previewEdit.mutate(
      { version: data.version, body: sqlBody },
      {
        onSuccess: (preview) => setOverridePreview(preview),
        onError: (err) => {
          const apiError = toApiError(err)
          setPreviewError(
            apiError.status === 429
              ? 'Demasiadas previsualizaciones seguidas; espera un momento.'
              : apiError.message,
          )
        },
      },
    )
  }

  const approveBaseline = () => {
    update.mutate({ version: data.version, body: { reviewed: true } })
  }

  const needsReview = data.reviewed === false
  const capturesSelects = data.capture_selects === true
  const deleteHint = DELETE_BLOCK_HINT[data.block_reason ?? 'none'](latestVersion)
  const split = frozen ? splitPatchBody(frozen.body) : null

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
              {/* Insignia informativa: NO deshabilita ninguna acción. El SQL nuevo es el que se
                  aplica de aquí en más; esto solo dice que alguna base se quedó con el viejo. */}
              {data.sql_diverged && (
                <Badge
                  tone="warning"
                  title="El SQL de esta versión se editó después de que alguna base la aplicara. Esas bases conservan el esquema anterior: esta versión ya no describe el plano de todas sus bases."
                >
                  ⚠ SQL editado tras aplicarse
                </Badge>
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
            <>
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
                // cambió entre la carga y el guardado. `unlocked` es la decisión explícita del
                // operador de tomar la vía de excepción.
                upSqlLocked={(data.sql_frozen || upSqlLocked) && !unlocked}
                onUnlockUpSql={() => setUnlocked(true)}
                onCreateNewVersion={onCreateNewVersion}
                onSubmitEdit={handleSubmitEdit}
                onCancel={() => {
                  // Salir de edición descarta de verdad: antes esto solo refetcheaba, y como
                  // react-hook-form no reinicializa sus `defaultValues`, lo tecleado seguía ahí.
                  setEditing(false)
                  setSubmitError(null)
                  setUnlocked(false)
                  setFrozen(null)
                }}
              />

              {/* Inline y debajo del formulario, no en un modal encima: el borrador tiene que
                  seguir montado y a la vista. */}
              {frozen && (
                <MigrationFreezePanel
                  modelId={modelId}
                  version={data.version}
                  blockingDatabases={frozen.blockingDatabases}
                  overrideAvailable={frozen.overrideAvailable}
                  requestId={frozen.requestId}
                  isPreviewing={previewEdit.isPending}
                  errorText={previewError}
                  onFixForward={onCreateNewVersion}
                  onOverride={startOverride}
                />
              )}
            </>
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
                    : ' porque alguna BD está hoy en ella o en una posterior'}
                  : al editar podrás cambiar el nombre, el rollback y los overrides. El SQL base
                  solo por la vía de excepción, que pide confirmación explícita.
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

      {overridePreview && split && (
        <MigrationEditOverrideDialog
          modelId={modelId}
          version={data.version}
          sqlBody={split.sqlBody}
          restBody={split.restBody}
          initialPreview={overridePreview}
          onClose={() => setOverridePreview(null)}
          onApplied={() => {
            setOverridePreview(null)
            setFrozen(null)
            setUnlocked(false)
            setEditing(false)
            void refetch()
          }}
        />
      )}
    </div>
  )
}
