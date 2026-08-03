import { useState, type ReactNode } from 'react'
import { Badge, Button, Checkbox, CodeBlock, Input, Modal } from '@/components/ui'
import { type ApiError } from '@/lib/api/errors'
import { type EngineType, type QueryPreviewOut } from '@/lib/contracts'
import { cn, engineLabel, formatInteger } from '@/lib/utils'
import { formatCountdown } from '@/lib/utils/countdown'
import { useCountdown } from '@/lib/utils/use-countdown'
import { dangerCopy, dryRunCannotRevertDdl, estimatedRowsTotal } from '../logic'
import { isSystemFailure, QUERY_ACTION_HINTS, type QueryErrorAction } from '../messages'

export interface ConfirmExecutionDialogProps {
  open: boolean
  preview: QueryPreviewOut
  database: string
  engine: EngineType
  /** Identidad legible ya compuesta, p. ej. `app_rw@%`. */
  identityLabel: string
  dryRun: boolean
  onDryRunChange: (next: boolean) => void
  isExecuting: boolean
  error: ApiError | null
  errorAction: QueryErrorAction | null
  notice: string | null
  onConfirm: (typedName: string) => void
  onClose: () => void
  /** Vuelve a clasificar la consulta sin cerrar el diálogo; refresca token y estimación. */
  onReanalyze: () => void
  /** El re-análisis está en curso. */
  isReanalyzing: boolean
}

/**
 * Confirmación de doble factor para los lotes `write` y `ddl`.
 *
 * Hoy el gateway no tiene un segundo factor real: transcribir el nombre de la base ES la
 * protección, no un trámite. De ahí tres decisiones que parecen incomodidades y son
 * deliberadas: el campo nace vacío en cada apertura (el cuerpo se monta condicionalmente,
 * así que el estado nace limpio sin resetear nada), el navegador tiene el autocompletado
 * apagado, y la habilitación exige igualdad EXACTA y sensible a mayúsculas.
 */
export function ConfirmExecutionDialog(props: ConfirmExecutionDialogProps) {
  if (!props.open) return null
  return <ConfirmExecutionDialogBody {...props} />
}

function ConfirmExecutionDialogBody({
  preview,
  database,
  engine,
  identityLabel,
  dryRun,
  onDryRunChange,
  isExecuting,
  error,
  errorAction,
  notice,
  onConfirm,
  onClose,
  onReanalyze,
  isReanalyzing,
}: ConfirmExecutionDialogProps) {
  const [typedName, setTypedName] = useState('')

  const copy = dangerCopy(preview.danger)
  const remaining = useCountdown(preview.expires_at ?? null)
  // Sin `expires_at` no hay vigencia que vigilar (el lote no exigía token): no se muestra
  // cuenta atrás ni se bloquea nada por caducidad.
  const hasDeadline = Boolean(preview.expires_at)
  const expired = hasDeadline && remaining <= 0

  const estimated = estimatedRowsTotal(preview)
  const ddlTrap = dryRunCannotRevertDdl(engine, preview.danger, dryRun)

  const nameMatches = typedName === database
  const canExecute = nameMatches && !expired && !isExecuting

  // El rojo se reserva a los fallos de sistema; el resto de los errores son condiciones del
  // flujo con salida propia y no merecen la alarma máxima.
  const errorIsSystemic = errorAction !== null && isSystemFailure(errorAction)

  return (
    <Modal
      open
      // Con el execute en vuelo el diálogo no se cierra: irse ahora dejaría al admin sin saber
      // el desenlace de una operación que ya está tocando el motor.
      onClose={() => {
        if (!isExecuting) onClose()
      }}
      title={copy.dialogTitle}
      description={copy.description}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isExecuting}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() => onConfirm(typedName)}
            isLoading={isExecuting}
            disabled={!canExecute}
          >
            {isExecuting ? 'Ejecutando…' : 'Ejecutar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
          <SummaryRow label="Base de datos">
            <code className="font-mono text-foreground">{database}</code>
          </SummaryRow>
          <SummaryRow label="Se ejecuta como">
            <code className="font-mono text-foreground">{identityLabel}</code>
          </SummaryRow>
          <SummaryRow label="Motor">{engineLabel(engine)}</SummaryRow>
          <SummaryRow label="Nivel">
            <Badge tone={copy.tone}>{copy.label}</Badge>
          </SummaryRow>
          <SummaryRow label="Sentencias">{formatInteger(preview.statements.length)}</SummaryRow>
        </dl>

        {/* La cifra de impacto va en grande y en el centro: es el dato que decide si esto se
            ejecuta o no, y en letra chica se lee después de haber decidido. */}
        <div className="flex flex-col items-center gap-1 rounded-card border border-warning/30 bg-warning/5 px-4 py-5 text-center">
          {estimated === null ? (
            <>
              <p className="text-lg font-semibold text-foreground">
                No se pudo estimar cuántas filas afectará
              </p>
              <p className="text-sm text-muted-foreground">
                Que no haya cifra NO significa que sean pocas: puede que el WHERE cruce tablas o que
                la identidad elegida no pueda contarlas.
              </p>
            </>
          ) : (
            <>
              <p className="text-4xl font-bold tabular-nums text-foreground">
                {formatInteger(estimated)}
              </p>
              <p className="text-sm font-medium text-foreground">
                filas estimadas afectadas por este lote
              </p>
              <p className="text-xs text-muted-foreground">
                Contadas con la misma credencial que va a ejecutar el lote.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Se van a ejecutar estas sentencias:</p>
          {preview.statements.map((statement) => (
            <CodeBlock
              key={statement.seq}
              code={statement.sql}
              title={`Sentencia ${statement.seq + 1} · ${statement.kind}`}
              extra={
                <Badge tone={dangerCopy(statement.danger).tone}>
                  {dangerCopy(statement.danger).label}
                </Badge>
              }
              maxHeightClass="max-h-40"
            />
          ))}
        </div>

        {preview.warnings.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 p-3">
            <p className="text-xs font-semibold text-foreground">Advertencias</p>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {preview.warnings.map((warning, index) => (
                // El backend no garantiza que los textos sean únicos: la posición es la clave estable.
                <li key={index} className="text-sm text-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Checkbox
          label="Ejecutar en modo de prueba y revertir al final"
          hint="El lote corre de verdad contra el motor y se deshace con un ROLLBACK: las cifras son reales, los cambios no."
          checked={dryRun}
          disabled={isExecuting}
          onChange={(event) => onDryRunChange(event.target.checked)}
        />

        {ddlTrap && (
          // La trampa del módulo. Tiene que verse ANTES de ejecutar: después ya es irreversible.
          <div className="flex flex-col gap-1 rounded-card border-2 border-error bg-error/10 p-4">
            <p className="text-base font-bold text-error">
              El modo de prueba NO puede revertir cambios de estructura en este motor
            </p>
            <p className="text-sm text-foreground">
              MySQL/MariaDB hacen COMMIT implícito en cada sentencia DDL: el ROLLBACK final no
              deshará lo que ya se aplicó al esquema.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">
            Escribí el nombre exacto de la base de datos para confirmar:
          </p>
          {/* Sin botón de copiar, a propósito: transcribir el nombre es la única barrera que
              queda entre el admin y una escritura irreversible, y copiar y pegar la anula. */}
          <code className="select-all break-all rounded-lg border border-border bg-surface-muted px-3 py-2 font-mono text-sm text-foreground">
            {database}
          </code>
          <Input
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            disabled={isExecuting}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono"
            aria-label={`Escribí «${database}» para confirmar`}
            hint="Debe coincidir exactamente, incluidas mayúsculas y minúsculas."
          />
          {typedName.length > 0 && (
            <p className={cn('text-xs', nameMatches ? 'text-success' : 'text-error')}>
              {nameMatches ? '✓ coincide' : '✗ no coincide'}
            </p>
          )}
        </div>

        {hasDeadline &&
          (expired ? (
            // Con el token vencido «Ejecutar» queda deshabilitado, así que dentro del diálogo
            // hace falta una salida real: el botón relanza la clasificación sin cerrar nada.
            <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <p className="text-sm text-foreground">
                Esta confirmación venció. Hay que volver a clasificar la consulta para obtener una
                nueva, porque la estimación de impacto pudo haber cambiado desde entonces.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={onReanalyze}
                isLoading={isReanalyzing}
              >
                Volver a clasificar
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Esta confirmación vence en{' '}
              <span className="font-mono text-foreground">{formatCountdown(remaining)}</span>
            </p>
          ))}

        {notice && (
          <p className="rounded-lg border border-border bg-surface-muted p-3 text-xs text-muted-foreground">
            {notice}
          </p>
        )}

        {error && errorAction && (
          <div
            className={cn(
              'flex flex-col gap-1 rounded-lg border p-3',
              errorIsSystemic ? 'border-error/30 bg-error/10' : 'border-border bg-surface-muted',
            )}
          >
            <p className={cn('text-sm', errorIsSystemic ? 'text-error' : 'text-foreground')}>
              {error.message}
            </p>
            <p className="text-xs text-muted-foreground">{QUERY_ACTION_HINTS[errorAction]}</p>
            {/* El `X-Request-ID` es lo único con lo que soporte puede rastrear el fallo. */}
            {errorIsSystemic && error.requestId && (
              <p className="text-xs text-muted-foreground">
                Código de soporte: <code className="select-all font-mono">{error.requestId}</code>
              </p>
            )}
          </div>
        )}

        {isExecuting && (
          // Va pegado al footer porque explica el estado de sus botones: la API no admite
          // abortar una ejecución, y un «Cancelar» gris sin motivo parece un bug.
          <p className="text-xs text-muted-foreground">
            La ejecución ya está en el motor y no se puede cancelar desde acá: hay que esperar a que
            termine o a que venza el timeout.
          </p>
        )}
      </div>
    </Modal>
  )
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{children}</dd>
    </div>
  )
}
