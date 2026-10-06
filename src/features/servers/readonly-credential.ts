import type { ApiError } from '@/lib/api/errors'
import type { ProcGrantEngineState, ServerOut } from '@/lib/contracts'
import { ENGINE_USER_ERROR_CODES } from './engine-user-messages'

/**
 * Credencial de SOLO LECTURA del servidor (api-reference-v30): la que usa el servidor MCP para leer
 * el catálogo de un motor. Lógica pura, sin React, para probarla sin montar nada.
 *
 * POR QUÉ EXISTE: las tools del MCP que leen el motor nunca usan la pseudo-root. Si el servidor no
 * tiene esta credencial, o la sonda negativa no la verificó hace poco, el gate responde
 * `mcp.readonly_credential_missing` y el agente no ve nada. Sin esta pantalla, cargarla exigía
 * llamar la API a mano con sesión, CSRF y step-up.
 */

/** El servidor no tiene credencial de solo lectura registrada (409 al probarla). */
export const READONLY_CREDENTIAL_MISSING = 'server.readonly_credential_missing'
/** La credencial puede escribir (422); `ApiError.readonlyProbeViolations` dice por qué. */
export const READONLY_PROBE_FAILED = 'server.readonly_probe_failed'

/** El acknowledgement de `routine-bodies` no es el texto exacto (422): la bandera no cambió. */
export const READONLY_PROC_GRANT_ACK_MISMATCH = 'server.readonly_proc_grant.ack_mismatch'
/**
 * El motor no necesita ni admite `SELECT ON mysql.proc` (422): PostgreSQL, MySQL >= 8.0, MariaDB >=
 * 11.3 o una versión ilegible. La bandera no cambió.
 */
export const READONLY_PROC_GRANT_ENGINE_UNSUPPORTED =
  'server.readonly_proc_grant.engine_unsupported'
/** Ya hay un aprovisionamiento de la credencial de este servidor en curso (409): no cambió nada. */
export const READONLY_PROVISION_IN_PROGRESS = 'readonly_provision.in_progress'

/**
 * Antigüedad máxima de la verificación, en días. Es el default de `MCP_READONLY_MAX_AGE_DAYS` del
 * backend, que es configurable: si el operador lo cambió, esta cifra es solo una PISTA y el que
 * decide es el gate. Pasado el plazo, el MCP niega aunque la credencial siga siendo válida, porque
 * una observación vieja ya no describe los grants de hoy.
 */
export const READONLY_MAX_AGE_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** ¿Trae zona horaria (`Z` u offset `±hh:mm`)? */
const HAS_TIMEZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/

/**
 * Estado de la credencial, en el orden en que el operador tiene que resolverlo:
 *
 * - `missing`: no hay credencial. El servidor está fuera del MCP.
 * - `unverified`: hay credencial pero la sonda nunca pasó (o se reemplazó, o falló). Fuera del MCP.
 * - `stale`: pasó la sonda, pero hace más de `READONLY_MAX_AGE_DAYS`. Fuera del MCP hasta reprobar.
 * - `verified`: el MCP la usa.
 */
export type ReadonlyCredentialState = 'missing' | 'unverified' | 'stale' | 'verified'

/**
 * Calcula el estado. `nowMs` entra por parámetro porque leer el reloj en render es impuro
 * (`react-hooks/purity`): quien la llama lo trae de estado.
 *
 * `readonly_verified_at` viaja en UTC **sin zona**; `Date.parse` lo leería en hora local y en
 * Buenos Aires la credencial vencería tres horas tarde. Se le agrega la `Z`, mismo criterio que
 * `formatUtcDateTime`.
 */
export function readonlyCredentialState(
  server: Pick<ServerOut, 'has_readonly_credential' | 'readonly_verified_at'>,
  nowMs: number,
): ReadonlyCredentialState {
  if (!server.has_readonly_credential) return 'missing'
  const verifiedAt = server.readonly_verified_at
  if (!verifiedAt) return 'unverified'
  const ms = Date.parse(HAS_TIMEZONE.test(verifiedAt) ? verifiedAt : `${verifiedAt}Z`)
  if (Number.isNaN(ms)) return 'unverified'
  return nowMs - ms > READONLY_MAX_AGE_DAYS * DAY_MS ? 'stale' : 'verified'
}

/** ¿El MCP puede leer este servidor? Solo con la credencial verificada y vigente. */
export function isReadonlyUsable(state: ReadonlyCredentialState): boolean {
  return state === 'verified'
}

/**
 * Motivos fijos de la sonda, en lenguaje de DBA. Los que llevan sufijo (`privilege:insert`) se
 * resuelven por prefijo en `readonlyViolationLabel`.
 */
const FIXED_VIOLATIONS: Record<string, string> = {
  select_on_mysql_schema: 'Puede leer el esquema `mysql` (incluye los hashes de las contraseñas).',
  grant_option: 'Tiene GRANT OPTION: puede otorgarle permisos a otras cuentas.',
  unrecognized_grant: 'Tiene un grant que la sonda no reconoce; revisalo a mano.',
  default_transaction_read_only_off: 'Sus sesiones no arrancan en modo de solo lectura.',
  create_on_database: 'Puede crear objetos en la base de datos (CREATE).',
  create_on_schema_public: 'Puede crear objetos en el esquema `public`.',
  table_write_privileges: 'Tiene privilegios de escritura sobre alguna tabla.',
  write_attempt_succeeded: 'La sonda intentó escribir y el motor lo permitió.',
}

const PREFIXED_VIOLATIONS: ReadonlyArray<[prefix: string, label: (value: string) => string]> = [
  ['privilege:', (value) => `Tiene el privilegio ${value.toUpperCase()}.`],
  ['global_privilege:', (value) => `Tiene ${value.toUpperCase()} a nivel global (*.*).`],
  ['role_attribute:', (value) => `El rol tiene el atributo ${value.toUpperCase()}.`],
  ['member_of:', (value) => `Es miembro del rol ${value}.`],
]

/**
 * Texto legible de un motivo de la sonda. Un motivo desconocido —uno que el backend agregue
 * después— se muestra tal cual: perderlo sería ocultarle al DBA justo lo que tiene que corregir.
 */
export function readonlyViolationLabel(reason: string): string {
  const fixed = FIXED_VIOLATIONS[reason]
  if (fixed) return fixed
  for (const [prefix, label] of PREFIXED_VIOLATIONS) {
    if (reason.startsWith(prefix) && reason.length > prefix.length) {
      return label(reason.slice(prefix.length))
    }
  }
  return reason
}

/**
 * Mensaje de los errores propios de la credencial de solo lectura, o `undefined` si el error es de
 * otra clase (y lo resuelve `notifyMutationError` con el `msg` del backend).
 */
export function readonlyCredentialErrorMessage(error: ApiError): string | undefined {
  if (error.code === READONLY_CREDENTIAL_MISSING) {
    return 'El servidor no tiene credencial de solo lectura. Cargala antes de verificarla.'
  }
  if (error.code === READONLY_PROBE_FAILED) {
    return 'La credencial puede escribir o tiene permisos de más. El MCP no la va a usar hasta que el DBA corrija sus grants.'
  }
  // Solo el aprovisionamiento automático lo emite: el nombre de la cuenta sale de la config del
  // gateway, no de un formulario, así que el operador no lo corrige desde acá.
  if (error.code === ENGINE_USER_ERROR_CODES.protectedAccount) {
    return 'El nombre de la cuenta de solo lectura configurado en el gateway es una cuenta reservada, la pseudo-root o un rol con privilegios de administración, y el gateway no la toca. Pedile al administrador del gateway que cambie esa configuración, o cargá una credencial manualmente.'
  }
  if (error.isRateLimited) {
    return 'Demasiados intentos seguidos. Esperá un minuto antes de volver a generar la credencial.'
  }
  return undefined
}

/**
 * Mensaje de los errores de `PUT .../routine-bodies`, o `undefined` si es de otra clase (lo resuelve
 * `notifyMutationError` con el `msg` del backend). Los tres códigos dejan la bandera como estaba.
 */
export function readonlyProcGrantErrorMessage(error: ApiError): string | undefined {
  if (error.code === READONLY_PROC_GRANT_ENGINE_UNSUPPORTED) {
    return 'Este servidor no necesita ni admite SELECT ON mysql.proc: solo aplica a MariaDB anterior a 11.3 y a MySQL 5.7. No se cambió nada.'
  }
  if (error.code === READONLY_PROC_GRANT_ACK_MISMATCH) {
    return 'Para habilitar la lectura de cuerpos de rutinas hay que aceptar el aviso completo. No se cambió nada.'
  }
  if (error.code === READONLY_PROVISION_IN_PROGRESS) {
    return 'Ya hay un cambio de la credencial de solo lectura en curso para este servidor. Esperá a que termine y reintentá; no se cambió nada.'
  }
  if (error.isRateLimited) {
    return 'Demasiados intentos seguidos. Esperá un minuto antes de volver a cambiar la lectura de cuerpos de rutinas.'
  }
  return undefined
}

/**
 * ¿Mostrar el control de «lectura de cuerpos de rutinas»? La SPA no conoce la versión del motor
 * (`ServerOut` no la trae), así que lo ofrece a toda la familia MySQL/MariaDB y deja que el backend
 * decida: en una versión que no lo necesita responde 422 `engine_unsupported`. Si la bandera ya
 * está encendida se muestra siempre —aunque el motor sea otro—, porque apagarla nunca debe quedar
 * fuera de alcance. PostgreSQL no tiene `mysql.proc`: sin bandera, no hay control.
 */
export function showsProcGrantControl(
  server: Pick<ServerOut, 'engine' | 'readonly_proc_grant'>,
): boolean {
  if (server.readonly_proc_grant === true) return true
  return server.engine === 'mysql' || server.engine === 'mariadb'
}

/** Resultado del cambio de la bandera, en palabras del operador. */
export interface ProcGrantOutcome {
  tone: 'success' | 'warning'
  title: string
  description: string
}

/**
 * Qué le cuenta la UI al operador según `engine_grant`. `not_alterable` es la que más importa: el
 * gateway no toca grants de una credencial cargada a mano, así que el cambio NO llegó al motor y,
 * si el DBA no ajusta los grants, el servidor queda sin verificar (el MCP cierra).
 */
export function procGrantOutcome(
  engineGrant: ProcGrantEngineState,
  enabled: boolean,
): ProcGrantOutcome {
  const appliedTitle = enabled
    ? 'Lectura de cuerpos de rutinas habilitada'
    : 'Lectura de cuerpos de rutinas deshabilitada'
  switch (engineGrant) {
    case 'converged':
      return {
        tone: 'success',
        title: appliedTitle,
        description: enabled
          ? 'El gateway re-aprovisionó la cuenta de solo lectura con SELECT ON mysql.proc y la sonda pasó.'
          : 'El gateway re-aprovisionó la cuenta de solo lectura sin SELECT ON mysql.proc y la sonda pasó.',
      }
    case 'not_alterable':
      return {
        tone: 'warning',
        title: 'Falta ajustar los grants en el motor',
        description: enabled
          ? 'La credencial se cargó a mano y el gateway no toca sus grants: agregale SELECT ON mysql.proc en el motor. Hasta que la sonda pase, el servidor queda sin verificar y el MCP no lo usa.'
          : 'La credencial se cargó a mano y el gateway no toca sus grants: quitale SELECT ON mysql.proc en el motor. Hasta que la sonda pase, el servidor queda sin verificar y el MCP no lo usa.',
      }
    case 'no_credential':
      return {
        tone: 'success',
        title: appliedTitle,
        description:
          'El servidor no tiene credencial de solo lectura: solo cambió la bandera, que se aplicará cuando se genere una.',
      }
  }
}
