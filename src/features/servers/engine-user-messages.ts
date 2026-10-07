import { toApiError, type ApiError } from '@/lib/api/errors'

/**
 * Copy de los rechazos de los guards de CUENTA PROTEGIDA del motor (usuarios del motor, no del
 * gateway) y del 403 de DELEGACIÓN de privilegios (`engine_user.grant_admin_required`).
 *
 * Los emiten todas las escrituras por identidad —alta con provisión, cambio y rotación de
 * contraseña, agregar host, eliminar del motor— y todo el módulo de grants (otorgar, revocar,
 * aplicar perfil). Por eso vive en un módulo propio y no repartido por los hooks: son muchas
 * pantallas en dos features (`servers` y `server-users`) diciendo lo mismo.
 *
 * Los textos son los del backend (`db_admin/protected_accounts.py`), tal cual: el backend y la UI
 * no divergen en cómo se le explica lo mismo al operador. Se mapean por `code` + `reason` y no se
 * delega en `detail.msg` porque el código es lo estable: el texto puede cambiar sin avisar.
 *
 * `protection_unverifiable` es un código DISTINTO a propósito: no es «no se puede», es «no se pudo
 * comprobar» (PostgreSQL no respondió al leer `pg_roles`). Invita a reintentar; el otro, no.
 */
export const ENGINE_USER_ERROR_CODES = {
  protectedAccount: 'engine_user.protected_account',
  protectionUnverifiable: 'engine_user.protection_unverifiable',
  /** 403: el grant delega privilegios y falta `engine_users.grant_admin` (solo `owner`). */
  grantAdminRequired: 'engine_user.grant_admin_required',
} as const

/** Motivo de `engine_user.protected_account` → texto. Vocabulario del backend. */
const PROTECTED_ACCOUNT_MESSAGES: Record<string, string> = {
  gateway_credential:
    'No se puede operar sobre la propia credencial pseudo-root del gateway (riesgo de auto-bloqueo). Para gestionar esa cuenta, hacelo fuera del gateway.',
  reserved_account:
    'La cuenta es una cuenta reservada del motor o de la nube administrada y el gateway no la modifica. Gestionala fuera del gateway.',
  privileged_role:
    'La cuenta tiene privilegios de administración del servidor (superusuario, creación de roles, replicación o equivalente) y el gateway no la modifica. Gestionala fuera del gateway.',
}

/** Motivo ausente o desconocido: vale para los tres casos sin afirmar cuál es. */
const PROTECTED_ACCOUNT_FALLBACK =
  'La cuenta está protegida y el gateway no la modifica. Gestionala fuera del gateway.'

/**
 * Motivo de `engine_user.grant_admin_required` → texto. A diferencia del 403 `access.forbidden`
 * (opaco), este SÍ nombra la capacidad: quien lo recibe ya tiene `engine_users.write` y eligió el
 * payload que delega, así que el texto no revela nada nuevo y le dice qué pedir.
 */
const GRANT_ADMIN_REQUIRED_MESSAGES: Record<string, string> = {
  with_grant_option:
    'Otorgar con WITH GRANT OPTION requiere la capacidad «engine_users.grant_admin», además de la de escribir usuarios del motor. Sin ella podés otorgar privilegios sin la opción de re-delegar.',
  sensitive_privilege:
    'Otorgar un privilegio sensible (por ejemplo ALL PRIVILEGES) requiere la capacidad «engine_users.grant_admin», además de la de escribir usuarios del motor. Sin ella podés otorgar privilegios no sensibles.',
  provision_reassign_owner:
    'Aplicar el cambio de propietario en el motor requiere la capacidad «engine_users.grant_admin», además de la de borrar bases. Sin ella podés reasignar solo el inventario.',
}

/** Motivo ausente o desconocido: nombra la capacidad sin afirmar cuál de los casos es. */
const GRANT_ADMIN_REQUIRED_FALLBACK =
  'Esta operación delega privilegios del motor y requiere la capacidad «engine_users.grant_admin». Pedíselo a quien administra los accesos.'

export const PROTECTION_UNVERIFIABLE_MESSAGE =
  'No se pudo verificar en el motor si la cuenta tiene privilegios de administración; por seguridad la operación no se ejecuta. Reintentá cuando el servidor responda.'

/**
 * Mensaje de un rechazo de cuenta protegida, o `null` si el error no es de este guard, para que
 * el llamador caiga en `apiError.message` y nunca oculte información.
 */
export function engineUserErrorMessage(error: ApiError): string | null {
  switch (error.code) {
    case ENGINE_USER_ERROR_CODES.protectedAccount: {
      const reason = error.guardContext?.reason
      return (reason && PROTECTED_ACCOUNT_MESSAGES[reason]) || PROTECTED_ACCOUNT_FALLBACK
    }
    case ENGINE_USER_ERROR_CODES.protectionUnverifiable:
      return PROTECTION_UNVERIFIABLE_MESSAGE
    case ENGINE_USER_ERROR_CODES.grantAdminRequired: {
      const reason = error.guardContext?.reason
      return (reason && GRANT_ADMIN_REQUIRED_MESSAGES[reason]) || GRANT_ADMIN_REQUIRED_FALLBACK
    }
    default:
      return null
  }
}

/**
 * Texto listo para un toast o una fila de resultado de una escritura sobre un usuario del motor:
 * el mensaje del guard si aplica, y si no el del backend. Acepta `unknown` porque es lo que le
 * llega a `onError` de TanStack Query.
 */
export function engineUserErrorDescription(error: unknown): string {
  const apiError = toApiError(error)
  return engineUserErrorMessage(apiError) ?? apiError.message
}
