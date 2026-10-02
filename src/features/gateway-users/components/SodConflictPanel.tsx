import { useId, useState } from 'react'
import { Button, Callout, Input, Textarea } from '@/components/ui'
import {
  SOD_RULE_EXPLANATION,
  sodRuleLabel,
  sodSourceLabel,
  type SodConflict,
  type SodSourceLabelOptions,
} from '@/features/auth'
import {
  SOD_OVERRIDE_MAX_HOURS,
  SOD_OVERRIDE_REASON_MAX,
  SOD_OVERRIDE_REASON_MIN,
  sodOverrideInSchema,
  type SodOverrideIn,
} from '@/lib/contracts'

/** Lista de reglas con lo que choca, compartida por el aviso previo y el rechazo del servidor. */
export function SodConflictList({
  conflicts,
  labelOptions,
}: {
  conflicts: readonly SodConflict[]
  labelOptions?: SodSourceLabelOptions
}) {
  return (
    <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
      {conflicts.map((conflict) => (
        <li key={conflict.rule}>
          <strong>{sodRuleLabel(conflict.rule)}</strong>
          {conflict.sources.length > 0 && (
            <>: {conflict.sources.map((s) => sodSourceLabel(s, labelOptions)).join(', ')}</>
          )}
          .
        </li>
      ))}
    </ul>
  )
}

interface SodConflictPanelProps {
  /** Lo que devolvió el 409 `access.sod_conflict`, ya normalizado. */
  conflicts: readonly SodConflict[]
  labelOptions?: SodSourceLabelOptions
  /** Reenvía EXACTAMENTE el mismo cambio, ahora con `sod_override`. */
  onResend: (override: SodOverrideIn) => void
  isPending?: boolean
  /** Rechazo del override (422 `access.sod_override_invalid`) u otro error del reenvío. */
  resendError?: string | null
  /** Límites que mandó el servidor en el 409; sin ellos rigen los del contrato. */
  reasonMinLength?: number
  maxHours?: number
  /** Qué hace el botón: «Guardar accesos con excepción», «Otorgar con excepción»… */
  resendLabel: string
}

/**
 * El rechazo de la separación de deberes FIJO en el formulario, más la salida de emergencia.
 *
 * Lo recomendado va primero y a la vista: repartir las funciones en cuentas distintas. La
 * excepción de emergencia (break-glass) queda detrás de un desplegable cerrado y en rojo, porque
 * es lo que la regla existe para evitar: queda auditada con el nombre de quien la declara y el
 * motivo, y vence sola (a lo sumo en 7 días). Al vencer, el servidor descarta las funciones de
 * oficial de seguridad de la cuenta.
 *
 * Quien lo monta le pone `key` por intento de guardado, así el motivo escrito no sobrevive a un
 * cambio distinto.
 */
export function SodConflictPanel({
  conflicts,
  labelOptions,
  onResend,
  isPending = false,
  resendError,
  reasonMinLength = SOD_OVERRIDE_REASON_MIN,
  maxHours = SOD_OVERRIDE_MAX_HOURS,
  resendLabel,
}: SodConflictPanelProps) {
  const ids = useId()
  const [reason, setReason] = useState('')
  const [hours, setHours] = useState(String(maxHours))
  const [errors, setErrors] = useState<{ reason?: string; hours?: string }>({})

  const submit = () => {
    const parsed = sodOverrideInSchema.safeParse({
      reason,
      expires_in_hours: hours.trim() === '' ? undefined : Number(hours),
    })
    // El servidor puede mandar límites más estrictos que los del contrato: se respetan los suyos.
    const tooShort = reason.trim().length < reasonMinLength
    const tooLong = hours.trim() !== '' && Number(hours) > maxHours
    if (!parsed.success || tooShort || tooLong) {
      const issue = (field: keyof SodOverrideIn) =>
        parsed.success
          ? undefined
          : parsed.error.issues.find((item) => item.path[0] === field)?.message
      setErrors({
        reason: tooShort ? `Mínimo ${reasonMinLength} caracteres` : issue('reason'),
        hours: tooLong ? `Máximo ${maxHours} horas` : issue('expires_in_hours'),
      })
      return
    }
    setErrors({})
    onResend(parsed.data)
  }

  return (
    <div className="flex flex-col gap-3">
      <Callout tone="danger" title="El servidor rechazó el cambio: separación de funciones">
        <p>{SOD_RULE_EXPLANATION}</p>
        <SodConflictList conflicts={conflicts} labelOptions={labelOptions} />
        <p className="mt-1">
          Lo recomendado es repartir las funciones: quitale a esta cuenta una de las dos y dásela a
          otra persona. No se guardó nada.
        </p>
      </Callout>

      {/* Secundario a propósito: cerrado por omisión, al final y en rojo. */}
      <details className="rounded-lg border border-error/40 bg-error/5 p-3">
        <summary className="cursor-pointer text-sm font-medium text-error">
          Excepción de emergencia
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-foreground">
            Solo para un incidente en el que no hay otra persona que pueda cubrir una de las
            funciones. Se aplica en el acto, queda auditada con tu nombre y el motivo, y vence sola:
            al vencer, el servidor desactiva las funciones de oficial de seguridad de esta cuenta.
          </p>
          <Textarea
            label="Motivo"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={SOD_OVERRIDE_REASON_MAX}
            hint={`Entre ${reasonMinLength} y ${SOD_OVERRIDE_REASON_MAX} caracteres: qué incidente lo justifica. ${reason.trim().length}/${SOD_OVERRIDE_REASON_MAX}`}
            error={errors.reason}
            className="min-h-16"
          />
          <div className="sm:w-48">
            <Input
              label="Duración (horas)"
              type="number"
              inputMode="numeric"
              min={1}
              max={maxHours}
              step={1}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              hint={`De 1 a ${maxHours} (7 días).`}
              error={errors.hours}
            />
          </div>
          {resendError && (
            <p id={`${ids}-error`} role="alert" className="text-sm text-error">
              {resendError}
            </p>
          )}
          <div>
            <Button
              type="button"
              variant="danger"
              isLoading={isPending}
              onClick={submit}
              aria-describedby={resendError ? `${ids}-error` : undefined}
            >
              {resendLabel}
            </Button>
          </div>
        </div>
      </details>
    </div>
  )
}
