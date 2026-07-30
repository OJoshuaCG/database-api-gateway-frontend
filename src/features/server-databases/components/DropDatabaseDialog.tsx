import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, Checkbox, Input, Modal, Spinner } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { DropPreviewOut, EngineType } from '@/lib/contracts'
import { useToast } from '@/lib/toast/use-toast'
import { cn } from '@/lib/utils'
import { useCountdown } from '../hooks/use-countdown'
import {
  useDropDatabasePreview,
  useDropServerDatabase,
} from '../hooks/use-server-database-mutations'
import { engineCopy, engineLabel, formatCountdown, shouldPreselectForceDisconnect } from '../logic'
import {
  classifyDropError,
  classifyPreviewError,
  DROP_ACTION_HINTS,
  DROP_ACTION_LABELS,
  isAuditFailure,
  PREVIEW_ACTION_HINTS,
  type DropErrorAction,
  type PreviewErrorAction,
} from '../messages'

interface DropDatabaseDialogProps {
  serverId: number
  serverName: string
  /** Ya formateado como "host:port". */
  serverEndpoint: string
  engine: EngineType
  database: string
  onClose: () => void
  /** Se llama tras un borrado exitoso, o al descubrir que la BD ya no existía. El padre cierra y refresca. */
  onDeleted: () => void
  /** Opcional: abre la vista de usuarios con permisos. Si no se pasa, no se muestra el enlace. */
  onShowGrantees?: () => void
}

type Step = 'preview' | 'confirm'

/** Espera visible tras un 429 del DELETE (límite de 3/min). Nunca hay reintento automático. */
const RATE_LIMIT_COOLDOWN_SECONDS = 20

/** Acciones de error del DELETE que ofrecen rehacer el preview sin salir del diálogo. */
type RecoverableDropAction = 'expiredToken' | 'invalidToken' | 'needsForceDisconnect'

/** De qué recuperación viene un preview: determina qué estado se conserva y a qué paso se vuelve. */
interface PreviewIntent {
  /** Conserva la casilla tal como la dejó el admin (token caducado: no cambió nada más). */
  keepForceDisconnect?: boolean
  /** Deja la casilla marcada (el motor rechazó el DROP por sesiones abiertas). */
  forceDisconnect?: boolean
  /** Paso al que volver si el escenario del motor sigue siendo el que el admin ya revisó. */
  nextStep?: Step
  /** Viene de un error del DELETE: un 404 aquí ya no es un fallo, es el resultado buscado. */
  afterDropError?: boolean
}

/**
 * Borrado IRREVERSIBLE de una base de datos física, en dos pasos: preview (§3.2, emite un
 * `confirm_token` con TTL de 2 min) y confirmación final por transcripción del nombre (§3.3).
 *
 * El padre lo monta condicionalmente, así que el componente nace con estado fresco y no hace
 * falta —ni está permitido— resetear nada con efectos.
 *
 * Principio rector de los errores: ningún camino termina en un mensaje rojo sin salida. Cada
 * código HTTP se traduce a UNA acción concreta (`classifyDropError`), y los que dejan el estado
 * del motor en duda (502/504/500) solo ofrecen comprobar el estado real, jamás reintentar.
 */
export function DropDatabaseDialog({
  serverId,
  serverName,
  serverEndpoint,
  engine,
  database,
  onClose,
  onDeleted,
  onShowGrantees,
}: DropDatabaseDialogProps) {
  const toast = useToast()
  const [step, setStep] = useState<Step>('preview')
  const [preview, setPreview] = useState<DropPreviewOut | null>(null)
  const [typedName, setTypedName] = useState('')
  const [forceDisconnect, setForceDisconnect] = useState(false)
  const [cooldownLeft, setCooldownLeft] = useState(0)

  const previewMutation = useDropDatabasePreview(serverId)
  const drop = useDropServerDatabase(serverId)

  const remaining = useCountdown(preview?.expires_at ?? null)
  const expired = preview !== null && remaining <= 0
  const copy = engineCopy(engine)

  const runPreview = (intent: PreviewIntent = {}) => {
    if (previewMutation.isPending || drop.isPending) return
    // Un preview nuevo invalida cualquier error del DELETE anterior: el token ya es otro.
    drop.reset()
    const previousConnections = preview?.active_connections ?? null

    previewMutation.mutate(database, {
      onSuccess: (data) => {
        setPreview(data)
        if (intent.forceDisconnect) setForceDisconnect(true)
        else if (!intent.keepForceDisconnect) {
          setForceDisconnect(shouldPreselectForceDisconnect(engine, data.active_connections))
        }
        // Si el motor cambió de estado mientras tanto, el admin tiene que rever las advertencias
        // antes de volver a la confirmación final: no se le devuelve directo al paso 2.
        const engineStateChanged =
          previousConnections !== null && previousConnections !== data.active_connections
        setStep(intent.nextStep === 'confirm' && !engineStateChanged ? 'confirm' : 'preview')
      },
      onError: (error) => {
        // Durante una recuperación, un 404 confirma justo lo que se buscaba: la base ya no está.
        if (intent.afterDropError && toApiError(error).status === 404) onDeleted()
      },
    })
  }

  const previewStartedRef = useRef(false)
  useEffect(() => {
    if (previewStartedRef.current) return
    previewStartedRef.current = true
    runPreview()
    // El preview emite un token de un solo uso y está limitado a 10/min: se lanza UNA vez al
    // montar y nunca por re-render, foco de ventana ni temporizador (§6.3).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Espera tras un 429: el descuento vive en el callback del temporizador (nunca en el cuerpo
  // del efecto) y al llegar a 0 el propio efecto se limpia solo.
  const cooldownActive = cooldownLeft > 0
  useEffect(() => {
    if (!cooldownActive) return
    const id = window.setInterval(() => setCooldownLeft((left) => Math.max(0, left - 1)), 1000)
    return () => window.clearInterval(id)
  }, [cooldownActive])

  const previewError = previewMutation.isError ? toApiError(previewMutation.error) : null
  const previewAction = previewError ? classifyPreviewError(previewError) : null
  const dropError = drop.isError ? toApiError(drop.error) : null
  const dropAction = dropError ? classifyDropError(dropError) : null

  const nameMatches = typedName === database
  const canDrop =
    preview !== null && nameMatches && !expired && cooldownLeft === 0 && !drop.isPending

  const handleCopyName = () => {
    // `navigator.clipboard` no existe fuera de un contexto seguro (HTTP sin TLS). Este botón es
    // la salida para nombres legados difíciles de transcribir, así que su ausencia se avisa en
    // vez de romper el diálogo: el nombre sigue seleccionable a mano.
    if (!navigator.clipboard) {
      toast.error('El portapapeles no está disponible', 'Copiá el nombre manualmente.')
      return
    }
    void navigator.clipboard
      .writeText(database)
      .then(() => toast.success('Nombre copiado al portapapeles'))
      .catch(() => toast.error('No se pudo copiar al portapapeles'))
  }

  const runDropRecovery = (action: RecoverableDropAction) => {
    if (action === 'expiredToken') {
      // Solo caducó el token: se conserva todo lo que el admin ya decidió y escribió.
      runPreview({ keepForceDisconnect: true, nextStep: 'confirm', afterDropError: true })
      return
    }
    if (action === 'needsForceDisconnect') {
      runPreview({ forceDisconnect: true, afterDropError: true })
      return
    }
    // Token inválido: nunca se reutiliza, y se vuelve al paso 1 con datos frescos del motor.
    runPreview({ afterDropError: true })
  }

  const handleDrop = () => {
    // Segunda barrera contra el doble envío: un segundo clic jamás dispara otro DELETE.
    if (drop.isPending || !canDrop || !preview) return
    drop.mutate(
      {
        database,
        body: {
          confirm_target_name: typedName,
          confirm_token: preview.confirm_token,
          force_disconnect: forceDisconnect,
        },
      },
      {
        onSuccess: () => onDeleted(),
        onError: (error) => {
          if (classifyDropError(toApiError(error)) === 'rateLimited') {
            setCooldownLeft(RATE_LIMIT_COOLDOWN_SECONDS)
          }
        },
      },
    )
  }

  const showPreviewStep = !previewMutation.isPending && !previewError && step === 'preview'
  const showConfirmStep = !previewMutation.isPending && !previewError && step === 'confirm'

  return (
    <Modal
      open
      // Mientras el DROP está en vuelo el diálogo no se puede cerrar: cerrarlo dejaría al admin
      // sin saber el desenlace de una operación irreversible ya lanzada.
      onClose={() => {
        if (!drop.isPending) onClose()
      }}
      title={
        step === 'confirm'
          ? `⚠️ Confirmación final — se eliminará «${database}»`
          : `⚠️ Eliminar base de datos «${database}»`
      }
      description={`Servidor ${serverName} · ${serverEndpoint} · Motor ${engineLabel(engine)}`}
      size="lg"
      footer={
        previewMutation.isPending ? (
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        ) : previewAction ? (
          <PreviewErrorFooter
            action={previewAction}
            onClose={onClose}
            onDeleted={onDeleted}
            onRetry={() => runPreview()}
          />
        ) : step === 'preview' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            {expired && (
              <Button variant="outline" onClick={() => runPreview()}>
                Volver a comprobar
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() => setStep('confirm')}
              disabled={!preview || expired}
            >
              Continuar →
            </Button>
          </>
        ) : dropAction === 'uncertain' || dropAction === 'checkStatus' ? (
          // Estado indeterminado: la ÚNICA acción ofrecida es comprobar el estado real.
          <Button variant="danger-soft" onClick={onDeleted}>
            {DROP_ACTION_LABELS[dropAction]}
          </Button>
        ) : dropAction === 'terminal' ? (
          <Button onClick={onClose}>Cerrar</Button>
        ) : dropAction === 'alreadyGone' ? (
          <Button onClick={onDeleted}>Cerrar</Button>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                // El error del DELETE pertenece al intento que se abandona: no debe reaparecer
                // al volver a entrar en la confirmación final.
                drop.reset()
                setStep('preview')
              }}
              disabled={drop.isPending}
            >
              ← Atrás
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={drop.isPending}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={handleDrop}
              isLoading={drop.isPending}
              disabled={!canDrop}
            >
              {drop.isPending ? 'Eliminando base de datos…' : 'Eliminar definitivamente 🔌'}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {previewMutation.isPending && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Comprobando la base de datos…
          </div>
        )}

        {previewAction && previewError && (
          <div className="flex flex-col gap-2 rounded-lg border border-error/30 bg-error/10 p-3">
            <p className="text-sm font-semibold text-error">No se pudo preparar el borrado</p>
            <p className="text-sm text-foreground">{previewError.message}</p>
            <p className="text-xs text-muted-foreground">{PREVIEW_ACTION_HINTS[previewAction]}</p>
            <SupportCode requestId={previewError.requestId} />
          </div>
        )}

        {showPreviewStep && (
          <>
            <div className="flex flex-col gap-2 rounded-card border-2 border-error bg-error/10 p-4">
              <p className="text-base font-bold text-error">
                🔌 Esta operación ejecuta DROP DATABASE en el motor real.
              </p>
              <p className="text-sm font-semibold text-foreground">
                Se eliminan de forma PERMANENTE todas las tablas, vistas, procedimientos,
                disparadores y DATOS de esta base. El gateway NO tiene copia de seguridad ni forma
                de revertirlo.
              </p>
            </div>

            {preview && (
              <>
                <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  <SummaryRow label="Conexiones activas">
                    {preview.active_connections > 0 ? (
                      <Badge tone="warning">{preview.active_connections}</Badge>
                    ) : (
                      <span className="text-foreground">0</span>
                    )}
                  </SummaryRow>
                  <SummaryRow label="Registrada en el gateway">
                    {preview.is_managed ? (
                      <span className="flex flex-col items-end gap-0.5 text-right">
                        <span className="text-foreground">
                          {preview.managed_database_id != null
                            ? `Sí (registro #${preview.managed_database_id})`
                            : 'Sí'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Su registro del inventario también se eliminará.
                        </span>
                      </span>
                    ) : (
                      <span className="text-foreground">No</span>
                    )}
                  </SummaryRow>
                  <SummaryRow label="La confirmación caduca en">
                    <span className={cn('font-mono', expired ? 'text-error' : 'text-foreground')}>
                      {formatCountdown(remaining)}
                    </span>
                  </SummaryRow>
                </dl>

                {preview.warnings && preview.warnings.length > 0 && (
                  <div className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/5 p-3">
                    <p className="text-xs font-semibold text-foreground">
                      Advertencias del servidor
                    </p>
                    <ul className="flex list-disc flex-col gap-1 pl-4">
                      {preview.warnings.map((warning, index) => (
                        // El backend no garantiza unicidad del texto: la posición es la clave estable.
                        <li key={index} className="text-xs text-foreground">
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Checkbox
                  label={`Terminar las ${preview.active_connections} conexiones activas antes de borrar (force_disconnect)`}
                  hint={
                    preview.active_connections === 0
                      ? `${copy.forceDisconnectHint} Ahora mismo no hay conexiones activas: no hay nada que terminar.`
                      : copy.forceDisconnectHint
                  }
                  checked={forceDisconnect}
                  disabled={preview.active_connections === 0}
                  onChange={(event) => setForceDisconnect(event.target.checked)}
                />

                {expired && (
                  <p className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
                    La confirmación caducó. Volvé a comprobar la base de datos para continuar.
                  </p>
                )}

                {onShowGrantees && (
                  <div>
                    <Button variant="ghost" size="sm" onClick={onShowGrantees}>
                      ¿Quién tiene permisos sobre esta base?
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {showConfirmStep && preview && (
          <>
            <p className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-foreground">
              {buildReminder(preview, serverName, forceDisconnect)}
            </p>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground">
                Escribí el nombre exacto de la base de datos para confirmar:
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
                <code className="flex-1 break-all font-mono text-sm text-foreground select-all">
                  {database}
                </code>
                <Button type="button" variant="ghost" size="sm" onClick={handleCopyName}>
                  Copiar
                </Button>
              </div>
              <Input
                value={typedName}
                onChange={(event) => {
                  // El 422 de nombre deja de aplicar en cuanto el admin corrige lo escrito.
                  if (dropAction === 'nameMismatch') drop.reset()
                  setTypedName(event.target.value)
                }}
                disabled={drop.isPending}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono"
                aria-label={`Escribí «${database}» para confirmar`}
                error={dropAction === 'nameMismatch' ? dropError?.message : undefined}
                hint="Debe coincidir exactamente, incluidas mayúsculas y minúsculas."
              />
              {typedName.length > 0 && (
                <p className={cn('text-xs', nameMatches ? 'text-success' : 'text-error')}>
                  {nameMatches ? '✓ coincide' : '✗ no coincide'}
                </p>
              )}
            </div>

            {expired ? (
              // Sin token no se puede enviar nada: se ofrece renovarlo aquí mismo, conservando
              // el nombre ya transcrito y la casilla, para no obligar a rehacer el paso 1.
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-error/30 bg-error/10 p-3">
                <p className="flex-1 text-sm text-error">
                  La confirmación caducó. Volvé a comprobar la base de datos para continuar.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runPreview({ keepForceDisconnect: true, nextStep: 'confirm' })}
                  disabled={drop.isPending}
                >
                  Volver a comprobar
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                La confirmación caduca en{' '}
                <span className="font-mono">{formatCountdown(remaining)}</span>
              </p>
            )}

            {cooldownLeft > 0 && (
              <p className="rounded-lg border border-error/30 bg-error/10 p-3 text-xs text-error">
                Esperá {cooldownLeft} s antes de volver a intentarlo (límite de 3 borrados por
                minuto).
              </p>
            )}

            {dropError && dropAction && dropAction !== 'nameMismatch' && (
              <div
                className={cn(
                  'flex flex-col gap-2 rounded-lg border p-3',
                  dropAction === 'alreadyGone'
                    ? 'border-border bg-surface-muted'
                    : 'border-error/30 bg-error/10',
                )}
              >
                {dropAction === 'uncertain' && (
                  <p className="text-sm font-bold text-error">
                    ⚠️ El borrado PUDO haberse ejecutado. No se reintenta.
                  </p>
                )}
                {dropAction === 'checkStatus' && isAuditFailure(dropError) && (
                  <p className="text-sm font-semibold text-foreground">
                    No se pudo registrar la operación en la auditoría; el borrado NO se ejecutó.
                  </p>
                )}
                <p
                  className={cn(
                    'text-sm',
                    dropAction === 'alreadyGone' ? 'text-foreground' : 'text-error',
                  )}
                >
                  {dropAction === 'alreadyGone'
                    ? 'La base de datos ya no existía en el servidor.'
                    : dropError.message}
                </p>
                {DROP_ACTION_HINTS[dropAction] && (
                  <p className="text-xs text-muted-foreground">{DROP_ACTION_HINTS[dropAction]}</p>
                )}
                <SupportCode requestId={dropError.requestId} />
                {isRecoverableDropAction(dropAction) && (
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runDropRecovery(dropAction)}
                      isLoading={previewMutation.isPending}
                    >
                      {DROP_ACTION_LABELS[dropAction]}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** Recordatorio compacto de lo que se va a ejecutar, ya con los efectos colaterales reales. */
function buildReminder(preview: DropPreviewOut, serverName: string, forceDisconnect: boolean) {
  const parts = [
    `DROP DATABASE en ${serverName}`,
    `${preview.active_connections} conexiones activas`,
  ]
  if (preview.is_managed) {
    parts.push(
      preview.managed_database_id != null
        ? `se eliminará también el registro #${preview.managed_database_id} del inventario`
        : 'se eliminará también su registro del inventario',
    )
  }
  if (forceDisconnect) parts.push('se terminarán las conexiones activas')
  return parts.join(' · ')
}

function isRecoverableDropAction(action: DropErrorAction): action is RecoverableDropAction {
  return action === 'expiredToken' || action === 'invalidToken' || action === 'needsForceDisconnect'
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

/** El `X-Request-ID` es lo único que permite rastrear la operación en el backend. */
function SupportCode({ requestId }: { requestId?: string }) {
  if (!requestId) return null
  return (
    <p className="text-xs text-muted-foreground">
      Código de soporte: <code className="font-mono select-all">{requestId}</code>
    </p>
  )
}

function PreviewErrorFooter({
  action,
  onClose,
  onDeleted,
  onRetry,
}: {
  action: PreviewErrorAction
  onClose: () => void
  onDeleted: () => void
  onRetry: () => void
}) {
  if (action === 'alreadyGone') {
    // La base ya no existe: el padre igual tiene que refrescar su lista.
    return <Button onClick={onDeleted}>Cerrar y actualizar la lista</Button>
  }
  if (action === 'terminal') return <Button onClick={onClose}>Cerrar</Button>
  return (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cancelar
      </Button>
      <Button variant="outline" onClick={onRetry}>
        {action === 'rateLimited' ? 'Reintentar' : 'Reintentar preview'}
      </Button>
    </>
  )
}
