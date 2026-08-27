import { useState } from 'react'
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
  type MigrationEditPreviewIn,
  type MigrationEditPreviewOut,
  type ModelMigrationPatch,
} from '@/lib/contracts'
import {
  useModelMigration,
  usePreviewModelMigrationEdit,
  useUpdateModelMigration,
} from '../hooks/use-model-migrations'
import { ModelMigrationForm } from './ModelMigrationForm'
import { MigrationSqlView } from './MigrationSqlView'
import { MigrationFreezePanel } from './MigrationFreezePanel'
import { MigrationEditOverrideDialog } from './MigrationEditOverrideDialog'
import { MigrationPartialProgressPanel } from './MigrationPartialProgressPanel'

interface ModelMigrationDetailPanelProps {
  modelId: number
  version: string | null
  /** Collation de referencia del blueprint, para explicar un COLLATE forzado que difiera. */
  blueprintCollation?: string | null
  /** Fix-forward: abre el formulario de nueva migración (cuando el up_sql ya se aplicó). */
  onCreateNewVersion: () => void
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
  blueprintCollation,
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

  const [submitError, setSubmitError] = useState<string | null>(null)
  const [upSqlLocked, setUpSqlLocked] = useState(false)
  const [editing, setEditing] = useState(false)
  /** El operador pidió «Editar de todos modos…»: el campo se desbloquea, no se guarda nada aún. */
  const [unlocked, setUnlocked] = useState(false)
  const [frozen, setFrozen] = useState<FrozenConflict | null>(null)
  const [overridePreview, setOverridePreview] = useState<MigrationEditPreviewOut | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  /**
   * El 409 `partial_application`, con su `incomplete_progress`. Va en estado propio y no en
   * `submitError` porque no es un texto: es una lista de bases con su punto de corte, y ese
   * detalle es lo único que permite decidir entre retomar el apply y limpiarlo con un stamp.
   */
  const [partial, setPartial] = useState<{
    rows: { managed_database_id: number; last_statement_index: number; total_statements: number }[]
    message: string
  } | null>(null)

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
    setPartial(null)
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
    setPartial(null)
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
            // es el que corrió. Se pinta con su propio panel porque `incomplete_progress` nombra
            // la base y la sentencia en la que quedó, y eso es accionable; el mensaje suelto no.
            setPartial({
              rows: apiError.incompleteProgress ?? [],
              message: apiError.message,
            })
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

  const capturesSelects = data.capture_selects === true
  const split = frozen ? splitPatchBody(frozen.body) : null

  return (
    <div className="flex flex-col gap-4">
      {/* El estado de la versión —insignias, avisos y la aprobación del baseline— vive en
          `VersionFactsCard`, arriba, junto al selector. Acá solo queda el SQL: había un «card
          delgado» que repetía las mismas insignias con un vocabulario propio, y era el tercero. */}

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
              {partial && (
                <MigrationPartialProgressPanel
                  modelId={modelId}
                  version={data.version}
                  rows={partial.rows}
                  message={partial.message}
                />
              )}

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

          <details className="rounded-lg border border-border p-3" open>
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              SQL traducido por motor (referencia)
            </summary>
            <div className="mt-3">
              <MigrationSqlView migration={data} />
            </div>
          </details>

        </CardContent>
      </Card>

      {overridePreview && split && (
        <MigrationEditOverrideDialog
          modelId={modelId}
          version={data.version}
          sqlBody={split.sqlBody}
          restBody={split.restBody}
          initialPreview={overridePreview}
          capturesSelects={capturesSelects}
          // El formulario manda `down_sql` SIEMPRE, así que "cambió" se decide comparando con el
          // valor del servidor y no con la presencia de la clave. Ojo: cuando la versión no tiene
          // rollback confirmado el formulario nace con el SUGERIDO, así que guardar sin tocar nada
          // ya es una edición de `down_sql` — y lo es de verdad: confirma el sugerido.
          downSqlChanged={(frozen?.body.down_sql ?? null) !== (data.down_sql ?? null)}
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
