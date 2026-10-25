/**
 * Texto accionable de los errores del flujo de aprobación de migraciones destructivas.
 *
 * Se clasifica por `ApiError.code` (`public_context.code`), nunca por la prosa del mensaje, y
 * jamás se muestra texto del motor: el backend tampoco lo manda. Cada mensaje dice QUÉ pasó y
 * QUÉ hacer, porque casi todos son rechazos de política y no fallos.
 */

import {
  DESTRUCTIVE_APPROVAL_ERROR_CODES as CODES,
  SELF_APPROVAL_FORBIDDEN_CODE,
  type ApprovalStatus,
  type DestructiveDirection,
} from '@/lib/contracts'

const MESSAGES: Record<string, string> = {
  [CODES.notFound]: 'La aprobación, la versión o la base ya no existe. Recargá la pantalla.',
  [CODES.notDestructive]:
    'Esa versión no es destructiva en la dirección elegida: no hay nada que aprobar.',
  [CODES.downSqlMissing]:
    'La versión no tiene SQL de reversa (down), así que no hay rollback que aprobar.',
  [CODES.scopeInvalid]: 'Esa base no usa este blueprint, así que la aprobación no le aplica.',
  [CODES.sqlChanged]:
    'El SQL de la versión cambió mientras lo revisabas. Recargá, leé el SQL nuevo y aprobalo de nuevo.',
  [CODES.duplicate]: 'Ya hay una aprobación vigente idéntica para esta versión.',
  [CODES.machineActor]:
    'Una aprobación la tiene que dar una persona: un token de agente o de integración no puede aprobar.',
  [CODES.confirmationRequired]:
    'Falta la confirmación: planificá con «dry-run», revisá el plan destructivo y confirmalo.',
  [CODES.confirmationInvalid]:
    'La confirmación no es válida para esta operación. Volvé a planificar con «dry-run» y confirmá de nuevo.',
  [CODES.confirmationExpired]:
    'La confirmación venció (dura 5 minutos). Volvé a planificar con «dry-run» para obtener una nueva.',
  [CODES.confirmPhraseMismatch]:
    'Lo que escribiste no coincide con lo que hay que repetir. No se ejecutó nada.',
  [CODES.batchMultiEnvironment]:
    'El lote alcanza más de un entorno protegido. Filtralo por un solo entorno y volvé a planificar.',
  [CODES.executorForbidden]:
    'No tenés permiso para ejecutar migraciones destructivas en esta base. Pedíselo a un owner.',
}

const SELF_APPROVAL_BY_RULE: Record<string, string> = {
  creator:
    'Creaste esta versión, así que no podés aprobarla: otra persona debe aprobarla (cuatro ojos).',
  last_editor:
    'Sos quien editó por última vez su SQL, así que no podés aprobarla: otra persona debe aprobarla (cuatro ojos).',
}

const SELF_APPROVAL_FALLBACK =
  'No podés aprobar una versión que creaste o editaste: otra persona debe aprobarla (cuatro ojos).'

/** Mensaje de un código, o `null` si no es de este flujo (el llamador cae a su texto propio). */
export function destructiveApprovalMessage(
  code: string | null | undefined,
  selfApprovalRule?: string | null,
): string | null {
  if (!code) return null
  if (code === SELF_APPROVAL_FORBIDDEN_CODE) {
    return (selfApprovalRule && SELF_APPROVAL_BY_RULE[selfApprovalRule]) || SELF_APPROVAL_FALLBACK
  }
  return MESSAGES[code] ?? null
}

/** Códigos tras los cuales el token ya no sirve y hay que volver a planificar (S39). */
export function requiresNewDryRun(code: string | null | undefined): boolean {
  return (
    code === CODES.confirmationExpired ||
    code === CODES.confirmationInvalid ||
    code === CODES.confirmationRequired
  )
}

/**
 * Texto del bloqueo `environment.destructive_blocked` según el sentido. En `down` el SQL que
 * destruye es el de reversa, y una aprobación de `up` no lo cubre: sin decirlo, quien aprobó el
 * apply no entiende por qué el rollback sigue bloqueado.
 */
export function destructiveBlockedMessage(
  direction: string | null | undefined,
  blockedVersions: readonly string[] | undefined,
): string {
  const versions = blockedVersions?.length ? ` Sin aprobar: ${blockedVersions.join(', ')}.` : ''
  if (direction === 'down') {
    return `El entorno bloquea el rollback destructivo hasta que se apruebe el SQL de reversa (la aprobación del apply no lo cubre).${versions}`
  }
  return `El entorno bloquea las migraciones destructivas hasta que una segunda persona las apruebe.${versions}`
}

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  approved: 'Aprobada',
  unapproved: 'Sin aprobar',
  revoked: 'Revocada',
  stale_hash: 'Aprobación vencida (SQL cambió)',
}

export const APPROVAL_STATUS_TONE: Record<
  ApprovalStatus,
  'success' | 'warning' | 'error' | 'neutral'
> = {
  approved: 'success',
  unapproved: 'warning',
  revoked: 'neutral',
  stale_hash: 'error',
}

/** Estado desconocido (backend más nuevo): se muestra crudo en vez de romper la fila. */
export function approvalStatusLabel(status: string): string {
  return APPROVAL_STATUS_LABEL[status as ApprovalStatus] ?? status
}

export function approvalStatusTone(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  return APPROVAL_STATUS_TONE[status as ApprovalStatus] ?? 'neutral'
}

export const DIRECTION_LABEL: Record<DestructiveDirection, string> = {
  up: 'Aplicar',
  down: 'Rollback',
}

export function directionLabel(direction: string): string {
  return DIRECTION_LABEL[direction as DestructiveDirection] ?? direction
}
