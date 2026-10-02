import type { ApiError } from '@/lib/api/errors'
import type { ServerOut } from '@/lib/contracts'

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
  return undefined
}
