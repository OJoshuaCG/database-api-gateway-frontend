import type { BadgeTone } from '@/components/ui'
import type { ApiError } from '@/lib/api/errors'
import {
  DATA_ACCESS_ERROR_CODES,
  type DataAccessState,
  type DataCredentialOut,
} from '@/lib/contracts'
import { readonlyViolationLabel } from '@/features/servers/readonly-credential'

/**
 * Lectura de DATOS por agentes (MCP): lógica pura del paso a paso de una base, sin React, para
 * probarla sin montar nada.
 *
 * POR QUÉ EXISTE: leer filas exige TRES cosas independientes y todas las decide el servidor —una
 * credencial de datos SELECT-only con sonda verde reciente, el opt-in de la base (con segundo
 * aprobador en production) y el kill switch del gateway—. La pantalla muestra las dos primeras;
 * la tercera no se puede saber desde acá y se avisa como tal.
 */

/**
 * Antigüedad máxima de la sonda, en días. Es el default de `MCP_DATA_CREDENTIAL_MAX_AGE_DAYS` del
 * backend, configurable: acá es una PISTA y el que decide es el gate (`PROBE_NOT_GREEN`).
 */
export const DATA_CREDENTIAL_MAX_AGE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** ¿Trae zona horaria (`Z` u offset `±hh:mm`)? */
const HAS_TIMEZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/

/**
 * Estado de la credencial de datos, en el orden en que se resuelve:
 * `missing` (no hay cuenta), `unverified` (la sonda nunca pasó, falló o se re-aprovisionó),
 * `stale` (pasó hace más de `DATA_CREDENTIAL_MAX_AGE_DAYS`) y `verified` (las tools la usan).
 */
export type DataCredentialStage = 'missing' | 'unverified' | 'stale' | 'verified'

/**
 * `verified_at` viaja en UTC **sin zona**: `Date.parse` lo leería en hora local y la verificación
 * vencería horas tarde (o antes). Se le agrega la `Z`, mismo criterio que `formatUtcDateTime`.
 * `nowMs` entra por parámetro: leer el reloj en render es impuro.
 */
export function dataCredentialStage(
  status: Pick<DataCredentialOut, 'has_data_credential' | 'verified_at'>,
  nowMs: number,
): DataCredentialStage {
  if (!status.has_data_credential) return 'missing'
  const verifiedAt = status.verified_at
  if (!verifiedAt) return 'unverified'
  const ms = Date.parse(HAS_TIMEZONE.test(verifiedAt) ? verifiedAt : `${verifiedAt}Z`)
  if (Number.isNaN(ms)) return 'unverified'
  return nowMs - ms > DATA_CREDENTIAL_MAX_AGE_DAYS * DAY_MS ? 'stale' : 'verified'
}

export const DATA_CREDENTIAL_STAGE_BADGE: Record<
  DataCredentialStage,
  { label: string; tone: BadgeTone }
> = {
  missing: { label: 'Sin credencial de datos', tone: 'neutral' },
  unverified: { label: 'Credencial sin verificar', tone: 'warning' },
  stale: { label: 'Verificación vencida', tone: 'warning' },
  verified: { label: 'Credencial verificada', tone: 'success' },
}

/** «Abierto» va en `warning`: es el estado que expone filas de un tercero a un agente. */
export const DATA_ACCESS_STATE_BADGE: Record<DataAccessState, { label: string; tone: BadgeTone }> =
  {
    closed: { label: 'Lectura de datos cerrada', tone: 'neutral' },
    pending: { label: 'Pedido pendiente de aprobación', tone: 'info' },
    open: { label: 'Lectura de datos abierta', tone: 'warning' },
  }

/**
 * ¿Las dos condiciones que la pantalla SÍ conoce están cumplidas? No promete lectura: falta el
 * kill switch del gateway, que solo ve el servidor.
 */
export function isDataReadReady(
  status: Pick<DataCredentialOut, 'has_data_credential' | 'verified_at' | 'data_access_state'>,
  nowMs: number,
): boolean {
  return dataCredentialStage(status, nowMs) === 'verified' && status.data_access_state === 'open'
}

/**
 * Motivos fijos de la sonda de datos; los de la sonda por servidor se resuelven con
 * `readonlyViolationLabel` (los comparten: `privilege:*`, `grant_option`, `member_of:*`…).
 */
const FIXED_DATA_VIOLATIONS: Record<string, string> = {
  all_privileges: 'Tiene ALL PRIVILEGES.',
  wildcard_database_pattern:
    'El grant de la base usa un patrón con `_` o `%` sin escapar: alcanza otras bases.',
  select_outside_database: 'Puede leer (SELECT) otras bases además de esta.',
  missing_select_on_database: 'No tiene SELECT sobre esta base.',
  foreign_engine_table:
    'Hay tablas FEDERATED/CONNECT/SPIDER: un SELECT saldría de la base hacia otro servidor.',
  foreign_access_extension: 'Hay una extensión (dblink/FDW) que permite leer fuera de esta base.',
  connection_limit: 'El límite de conexiones de la cuenta no es el esperado.',
  statement_timeout_unset: 'La cuenta no tiene un tiempo máximo de sentencia.',
  engine_unsupported: 'El motor de este servidor no admite la credencial de datos.',
  member_of_role: 'Es miembro de otro rol: hereda privilegios que esta credencial no declara.',
  unrecognized_grant: 'Tiene un grant que la sonda no reconoce; revisalo a mano.',
}

const PREFIXED_DATA_VIOLATIONS: ReadonlyArray<[prefix: string, label: (value: string) => string]> =
  [
    ['extra_privilege:', (value) => `Tiene el privilegio de más ${value.toUpperCase()}.`],
    ['global_privilege:', (value) => `Tiene ${value.toUpperCase()} a nivel global (*.*).`],
  ]

/**
 * Texto legible de un motivo de la sonda de datos. Un motivo desconocido —uno que el backend agregue
 * después— se muestra tal cual: perderlo ocultaría justo lo que el DBA tiene que corregir.
 */
export function dataViolationLabel(reason: string): string {
  const fixed = FIXED_DATA_VIOLATIONS[reason]
  if (fixed) return fixed
  for (const [prefix, label] of PREFIXED_DATA_VIOLATIONS) {
    if (reason.startsWith(prefix) && reason.length > prefix.length) {
      return label(reason.slice(prefix.length))
    }
  }
  return readonlyViolationLabel(reason)
}

/**
 * Mensaje de los errores propios del opt-in y de la credencial de datos, o `undefined` si el error
 * es de otra clase (y lo resuelve `notifyMutationError` con el `msg` del backend).
 */
export function dataAccessErrorMessage(error: ApiError): string | undefined {
  switch (error.code) {
    case DATA_ACCESS_ERROR_CODES.selfApproval:
      return 'No podés aprobar tu propio pedido: lo tiene que aprobar otro owner con acceso a datos en este entorno.'
    case DATA_ACCESS_ERROR_CODES.notPending:
      return 'No hay un pedido pendiente de aprobación (se aprobó, se canceló o nunca se pidió). Refrescá el estado.'
    case DATA_ACCESS_ERROR_CODES.alreadyOpen:
      return 'El acceso a datos de esta base ya está abierto. Cerralo antes de volver a pedirlo.'
    case DATA_ACCESS_ERROR_CODES.credentialMissing:
      return 'La base no tiene credencial de datos. Generala y verificala antes de abrir el acceso.'
    case DATA_ACCESS_ERROR_CODES.identityRequired:
      return 'No se pudo identificar a tu usuario: el pedido y la aprobación quedan a nombre de una persona.'
    case DATA_ACCESS_ERROR_CODES.accountAlreadyExists:
      return 'En el motor ya existe una cuenta con ese nombre que el gateway no creó. No se tocó: pedile al administrador del gateway que cambie el prefijo de las cuentas de datos.'
    case DATA_ACCESS_ERROR_CODES.provisionInProgress:
      return 'Ya hay un aprovisionamiento o una revocación de esta base en curso. Esperá a que termine y reintentá.'
    case DATA_ACCESS_ERROR_CODES.databaseNotEligible:
      return 'La base no admite credencial de datos: no está activa en el motor, es de sistema o es la base de metadatos del gateway.'
    case DATA_ACCESS_ERROR_CODES.probeFailed:
      return 'La cuenta puede más que leer esta base. Ninguna tool de datos la usa hasta que el DBA corrija sus grants y se vuelva a verificar.'
    default:
      return undefined
  }
}
