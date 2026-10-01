import type { ApiError } from '@/lib/api/errors'
import type { EngineType, SslMode } from '@/lib/contracts'

/**
 * Re-apuntar un servidor exige volver a ingresar la contraseña del usuario administrador
 * (422 `server.credential_required_for_rebind`).
 *
 * POR QUÉ (backend, `ServerController._rebind_fields`): sin la contraseña en el mismo `PATCH`, la
 * credencial cifrada sobrevivía al cambio de destino y la próxima operación se la mandaba al host
 * NUEVO. Un host controlado por quien edita la pide en claro sin esfuerzo, y bajar `ssl_mode` en el
 * mismo cambio le quita además el TLS.
 *
 * La UI lo ANTICIPA —marca la contraseña como obligatoria en cuanto se toca uno de esos campos—
 * para no llevar al operador hasta el 422, pero **decide el backend**: este módulo replica su
 * regla para avisar, no para autorizar. Si divergieran, el 422 lo corrige igual.
 */
export const CREDENTIAL_REQUIRED_FOR_REBIND = 'server.credential_required_for_rebind'

export const REBIND_MESSAGE =
  'Cambiar el host, el puerto o el motor del servidor, o debilitar su TLS, exige volver a ingresar la contraseña del usuario administrador.'

/** Campo que re-apunta la credencial. Vocabulario de `public_context.fields`. */
export type RebindField = 'host' | 'port' | 'engine' | 'ssl_mode'

const FIELD_LABELS: Record<RebindField, string> = {
  host: 'host',
  port: 'puerto',
  engine: 'motor',
  ssl_mode: 'modo TLS',
}

/** Lo que se compara entre el servidor guardado y el formulario. */
export interface RebindBaseline {
  host: string
  port: number
  engine: EngineType
  ssl_mode: SslMode | null
}

/**
 * Fuerza de cada modo TLS, igual que `_SSL_STRENGTH` del backend. Solo cuenta como «debilitar»
 * bajar desde `require` o más fuerte: pasar de `prefer` a `disable` no re-apunta nada que el
 * servidor hubiera exigido cifrado.
 */
const SSL_STRENGTH: Record<SslMode, number> = {
  disable: 0,
  allow: 1,
  prefer: 2,
  require: 3,
  'verify-ca': 4,
  'verify-full': 5,
}

function sslStrength(mode: SslMode | null): number {
  return mode ? SSL_STRENGTH[mode] : 0
}

/**
 * Campos del formulario que re-apuntan la credencial respecto del servidor guardado. Misma regla
 * que el backend: el host se compara sin espacios ni mayúsculas, y `root_username` no dispara
 * (la credencial sigue yendo al mismo destino).
 */
export function rebindFields(original: RebindBaseline, next: RebindBaseline): RebindField[] {
  const fields: RebindField[] = []
  if (next.host.trim().toLowerCase() !== original.host.trim().toLowerCase()) fields.push('host')
  if (next.port !== original.port) fields.push('port')
  if (next.engine !== original.engine) fields.push('engine')
  const before = sslStrength(original.ssl_mode)
  if (before >= SSL_STRENGTH.require && sslStrength(next.ssl_mode) < before) {
    fields.push('ssl_mode')
  }
  return fields
}

/** «host, puerto», en español y en el orden recibido. Ignora nombres que no conoce. */
export function rebindFieldsLabel(fields: readonly string[]): string {
  return fields
    .filter((field): field is RebindField => field in FIELD_LABELS)
    .map((field) => FIELD_LABELS[field])
    .join(', ')
}

/** El aviso completo, con la lista de campos cuando hay alguno reconocible. */
export function rebindMessage(fields: readonly string[]): string {
  const label = rebindFieldsLabel(fields)
  return label ? `${REBIND_MESSAGE} Cambiaste: ${label}.` : REBIND_MESSAGE
}

/**
 * Mensaje del 422 de re-apuntado, o `null` si el error es otro. El `msg` del backend nombra el
 * campo técnico (`'root_password'`) y no dice cuál de los cuatro disparó la exigencia; este sí.
 */
export function serverRebindErrorMessage(error: ApiError): string | null {
  if (error.code !== CREDENTIAL_REQUIRED_FOR_REBIND) return null
  return rebindMessage(error.guardContext?.fields ?? [])
}
