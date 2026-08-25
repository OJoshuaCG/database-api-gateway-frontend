import { useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { formatCountdown } from '@/lib/utils/countdown'
import { useCountdown } from '@/lib/utils/use-countdown'
import {
  MIGRATION_ERROR_CODES,
  type BlockingDatabase,
  type MigrationEditPreviewIn,
  type MigrationEditPreviewOut,
  type ModelMigrationPatch,
} from '@/lib/contracts'
import {
  useConfirmModelMigrationEdit,
  usePreviewModelMigrationEdit,
} from '../hooks/use-model-migrations'
import { BlockingDatabasesList } from './BlockingDatabasesList'

interface MigrationEditOverrideDialogProps {
  modelId: number
  version: string
  /**
   * Subconjunto de SQL EXACTO que se previsualizó. Tiene que ser el mismo objeto —mismas claves,
   * mismos valores— que después viaja en el PATCH: el checksum se calcula por presencia de clave,
   * así que una de más o de menos invalida el token.
   */
  sqlBody: MigrationEditPreviewIn
  /** Resto del PATCH (nombre, revisión…). No entra en el checksum. */
  restBody: Omit<ModelMigrationPatch, keyof MigrationEditPreviewIn>
  /**
   * Resultado de la PRIMERA previsualización, que dispara el panel del 409 al pulsar «Editar
   * igual…». Llega por props y no se pide aquí al montar: lanzar la llamada desde el render de
   * este componente sería un efecto encubierto, y hacerlo desde un `useEffect` obligaría a
   * sincronizar estado con props. Las re-previsualizaciones sí nacen acá, pero de un clic.
   */
  initialPreview: MigrationEditPreviewOut
  /** ¿La versión tiene la captura de `SELECT` activada? Gobierna dos efectos colaterales. */
  capturesSelects: boolean
  /** ¿El cuerpo enviado cambia `down_sql` respecto del valor del servidor? */
  downSqlChanged: boolean
  onClose: () => void
  /** Se llama tras el 200, cuando el usuario cierra el resultado. */
  onApplied: () => void
}

type Step = 'preview' | 'confirm' | 'result'

/** ¿Cambió la lista de bloqueantes entre dos previsualizaciones? */
function blockingChanged(before: BlockingDatabase[], after: BlockingDatabase[]): boolean {
  if (before.length !== after.length) return true
  return before.some(
    (row, index) => row.managed_database_id !== after[index]?.managed_database_id,
  )
}

/**
 * Vía de excepción para editar una versión de blueprint **ya aplicada** (api-reference-v15).
 *
 * Es un flujo de **dos pasos** y no un interruptor, y esa es toda la decisión de diseño: un botón
 * «Forzar» de un clic convierte en trámite algo irreversible. El paso 1 muestra a quién se va a
 * dejar divergente **antes** de pedir nada; el paso 2 exige reconocerlo y escribir la versión. Por
 * eso mismo la palabra «Forzar» no aparece en ningún texto: no es un forzado, es una decisión con
 * consecuencias declaradas.
 *
 * **El borrador NO vive aquí.** El SQL está en el formulario de la pantalla de atrás, que sigue
 * montado: perder doscientas líneas de DDL porque un token venció a los dos minutos sería el peor
 * fallo posible de esta pantalla. Cancelar, que caduque el token o cualquier error devuelven al
 * formulario con todo lo escrito intacto.
 */
export function MigrationEditOverrideDialog({
  modelId,
  version,
  sqlBody,
  restBody,
  initialPreview,
  capturesSelects,
  downSqlChanged,
  onClose,
  onApplied,
}: MigrationEditOverrideDialogProps) {
  const [step, setStep] = useState<Step>('preview')
  const [preview, setPreview] = useState<MigrationEditPreviewOut>(initialPreview)
  const [acknowledged, setAcknowledged] = useState(false)
  const [versionInput, setVersionInput] = useState('')
  const [error, setError] = useState<{ text: string; repreview: boolean } | null>(null)

  const previewEdit = usePreviewModelMigrationEdit(modelId)
  const confirmEdit = useConfirmModelMigrationEdit(modelId)

  // La vigencia sale SIEMPRE de `expires_at`: el TTL empieza a correr en el servidor y no viaja
  // en la respuesta, así que una constante local mentiría por el tiempo de red.
  const remaining = useCountdown(preview.expires_at)
  const tokenAlive = preview.confirm_token !== null && remaining > 0
  const blocking = preview.blocking_databases
  const onlyUnreadable = blocking.length > 0 && blocking.every((row) => row.reason === 'unreadable')

  const runPreview = () => {
    setError(null)
    previewEdit.mutate(
      { version, body: sqlBody },
      {
        onSuccess: (data) => {
          // Si la lista de bloqueantes cambió, se vuelve a exigir el reconocimiento: lo que el
          // usuario aceptó describía otra lista.
          if (blockingChanged(blocking, data.blocking_databases)) setAcknowledged(false)
          setPreview(data)
          setStep('preview')
        },
        onError: (err) => {
          const apiError = toApiError(err)
          setError({
            text:
              apiError.status === 429
                ? 'Demasiadas previsualizaciones seguidas; espera un momento.'
                : apiError.message,
            repreview: false,
          })
        },
      },
    )
  }

  const submit = () => {
    setError(null)
    confirmEdit.mutate(
      {
        version,
        body: {
          ...restBody,
          ...sqlBody,
          // Los dos factores van juntos o no va ninguno. Cuando no hace falta confirmar, el
          // backend manda `confirm_token: null` y aquí no se agrega ninguno.
          ...(preview.confirm_token !== null
            ? {
                confirm_version: preview.confirm_version,
                confirm_token: preview.confirm_token,
              }
            : {}),
        },
      },
      {
        onSuccess: () => setStep('result'),
        onError: (err) => {
          const apiError = toApiError(err)
          // El 410 y el 422 del token NO traen `code`: salen del servicio de tokens, que es
          // compartido con otros módulos. Se clasifican por status, y los dos llevan al mismo
          // sitio — volver a previsualizar. Nunca se re-previsualiza en silencio ni se reintenta
          // con el mismo token: el usuario tiene que volver a ver a quién deja divergente.
          if (apiError.status === 410) {
            setError({
              text: 'La confirmación caducó (vale unos dos minutos). Vuelve a previsualizar; tu SQL se conservó.',
              repreview: true,
            })
            return
          }
          if (apiError.status === 422 && apiError.code === undefined) {
            setError({
              text: 'El SQL cambió después de la previsualización. Vuelve a previsualizar para confirmar sobre el texto actual.',
              repreview: true,
            })
            return
          }
          if (apiError.code === MIGRATION_ERROR_CODES.sqlFrozen) {
            setAcknowledged(false)
            setError({
              text: 'Las bases bloqueantes cambiaron desde la previsualización. Revísalas de nuevo antes de confirmar.',
              repreview: true,
            })
            return
          }
          setError({ text: apiError.message, repreview: false })
        },
      },
    )
  }

  const title =
    step === 'result'
      ? `Versión ${version} actualizada — ${blocking.length} bases NO se corrigieron`
      : step === 'confirm'
        ? `Editar la versión ${version} — Paso 2 de 2: confirmación`
        : `Editar la versión ${version} — Paso 1 de 2: qué va a quedar divergente`

  const countdownLabel = tokenAlive
    ? `La confirmación caduca en ${formatCountdown(remaining)}.`
    : 'La confirmación caducó.'

  return (
    <Modal
      open
      onClose={step === 'result' ? onApplied : onClose}
      title={title}
      size="lg"
      footer={
        step === 'result' ? (
          <div className="flex justify-end">
            <Button onClick={onApplied}>Volver a la versión</Button>
          </div>
        ) : step === 'confirm' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{countdownLabel}</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep('preview')}>
                ← Volver al paso 1
              </Button>
              <Button
                // Guarda triple: reconocimiento marcado, versión coincidente y token vigente.
                disabled={!acknowledged || versionInput !== version || !tokenAlive}
                isLoading={confirmEdit.isPending}
                onClick={submit}
              >
                Guardar la edición
              </Button>
            </div>
          </div>
        ) : !preview.requires_confirmation ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button isLoading={confirmEdit.isPending} onClick={submit}>
              Guardar ahora
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{countdownLabel}</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={previewEdit.isPending}>
                Cancelar
              </Button>
              <Button variant="outline" isLoading={previewEdit.isPending} onClick={runPreview}>
                Volver a leer del motor
              </Button>
              {tokenAlive ? (
                <Button onClick={() => setStep('confirm')}>Continuar a la confirmación →</Button>
              ) : (
                // Caducado: no se re-previsualiza solo. La lista de bases pudo cambiar y el
                // usuario tiene que volver a verla antes de confirmar nada.
                <Button isLoading={previewEdit.isPending} onClick={runPreview}>
                  Volver a previsualizar
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded-lg border border-error/40 bg-error/5 p-3 text-sm text-error"
          >
            <span>{error.text}</span>
            {error.repreview && (
              <Button
                variant="outline"
                size="sm"
                isLoading={previewEdit.isPending}
                onClick={runPreview}
              >
                Volver a previsualizar
              </Button>
            )}
          </div>
        )}

        {step === 'preview' && !preview.requires_confirmation && (
          <p className="text-sm text-muted-foreground">
            Ninguna base de datos tiene esta versión vigente en este momento, así que se puede
            editar sin confirmación.
          </p>
        )}

        {step === 'preview' && preview.requires_confirmation && (
          <>
            {/* El aviso es lo más prominente de la pantalla, no colapsable y arriba de la lista:
                es el malentendido más probable de toda la feature. */}
            <div className="flex flex-col gap-2 rounded-lg border border-warning/50 bg-warning/5 p-4">
              <p className="text-base font-semibold text-foreground">
                Esta edición NO corrige ninguna base de datos
              </p>
              <p className="text-sm text-muted-foreground">
                Guardar el SQL corregido no ejecuta nada en ningún motor. Las {blocking.length}{' '}
                bases listadas conservan{' '}
                <strong className="text-foreground">físicamente</strong> el esquema que ya se les
                aplicó; lo único que cambia es el texto que esta versión declara.
              </p>
              <p className="text-sm text-muted-foreground">
                A partir de ahora, esta versión describe un SQL que esas bases nunca ejecutaron: la
                divergencia es real y no se puede deshacer. Las bases listadas siguen necesitando la
                corrección <strong className="text-foreground">por otra vía</strong> — si el cambio
                es de charset o collation, esa vía es la conversión de charset/collation, que además
                recrea rutinas, triggers y vistas (congelan la collation de la sesión que las creó)
                y evita el error «Illegal mix of collations». Un CONVERT TO CHARACTER SET escrito a
                mano dentro de una versión de blueprint no hace eso.
              </p>
              <p className="text-sm text-muted-foreground">
                Lo que sí se corrige: toda base que aplique esta versión de aquí en adelante.
              </p>
            </div>

            {/* Efectos colaterales de la §4.bis, solo los que apliquen. No es letra chica: quien
                confirma un rollback no está pensando en la captura, y perder la aprobación sin
                aviso convierte un guardado en una versión que de golpe no se puede aplicar. */}
            {(capturesSelects || downSqlChanged) && (
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-3">
                <span className="text-sm font-medium text-foreground">
                  Además de la divergencia, esta edición provoca:
                </span>
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {downSqlChanged && capturesSelects && (
                    <li>
                      Se eliminan las capturas de resultados de <code>SELECT</code> de dirección{' '}
                      <code>down</code> de esta versión: sus índices de sentencia dejarían de
                      apuntar a lo mismo.
                    </li>
                  )}
                  {capturesSelects && (
                    <li>
                      La aprobación para aplicar se <strong>revoca</strong>: habrá que volver a
                      aprobar la versión antes de poder usarla.
                    </li>
                  )}
                  <li>
                    El rollback <em>sugerido</em> se regenera a partir del SQL nuevo. El rollback
                    confirmado no se toca.
                  </li>
                </ul>
              </div>
            )}

            {onlyUnreadable && (
              <p className="rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
                No se pudo verificar ninguna de las bases con historial de esta versión. Puede que
                ya no la tengan, o que el motor esté caído: el gateway no puede distinguirlo, así
                que las cuenta como bloqueantes. Lo recomendable es arreglar la conexión y volver a
                previsualizar.
              </p>
            )}

            <BlockingDatabasesList modelId={modelId} rows={blocking} />

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Checksum resultante:</span>
              <code className="rounded bg-surface-muted px-1.5 py-0.5">
                {preview.resulting_checksum}
              </code>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <p className="text-sm text-muted-foreground">
              {blocking.length} base(s) quedarán divergentes. Conservan el esquema que ya tienen y
              necesitan corregirse por otra vía.
            </p>

            <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span className="text-muted-foreground">
                Entiendo que esta edición no ejecuta nada: las {blocking.length} bases listadas
                seguirán con el esquema que ya tienen y necesitarán corregirse por otra vía.
              </span>
            </label>

            {/* No se autocompleta a propósito: el backend solo comprueba igualdad, así que
                rellenarlo lo convertiría en un campo decorativo y dejaría la puerta abierta a
                editar la versión equivocada desde una pestaña vieja. */}
            <Input
              label="Escribe el número de versión para confirmar que es la que quieres editar"
              hint={`Versión a editar: ${version}`}
              value={versionInput}
              error={
                versionInput !== '' && versionInput !== version
                  ? `Debe ser exactamente «${version}».`
                  : undefined
              }
              onChange={(event) => setVersionInput(event.target.value)}
            />
          </>
        )}

        {step === 'result' && (
          <>
            <div className="flex flex-col gap-2 rounded-lg border border-success/40 bg-success/5 p-3">
              <span className="text-sm font-semibold text-foreground">Qué cambió</span>
              <p className="text-sm text-muted-foreground">
                Esta versión declara ahora el SQL corregido. Toda base de datos que aplique esta
                versión de aquí en adelante usará el SQL nuevo.
              </p>
            </div>

            {/* Mismo peso visual que el bloque de arriba: la pantalla de resultado repite el
                aviso, no lo da por leído. */}
            <div className="flex flex-col gap-2 rounded-lg border border-warning/50 bg-warning/5 p-3">
              <span className="text-sm font-semibold text-foreground">
                Estas {blocking.length} bases NO se corrigieron
              </span>
              <BlockingDatabasesList modelId={modelId} rows={blocking} />
              <p className="text-sm text-muted-foreground">
                Esta edición no ejecutó nada en esos motores. La corrección de esas bases es una
                operación aparte.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              La divergencia quedó registrada en la auditoría del gateway. La insignia «SQL editado
              tras aplicarse» es permanente y no restringe ninguna acción.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
