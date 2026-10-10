import { INTEGRATION_TOKEN_ERROR_CODES, type IntegrationScopeTier } from '@/lib/contracts'
import type { ApiError } from '@/lib/api/errors'

/** Títulos de los grupos del selector, por tier que informa el servidor. */
export const INTEGRATION_TIER_TITLES: Readonly<Record<IntegrationScopeTier, string>> = {
  read: 'Lectura',
  write: 'Escritura',
  destructive: 'Destructivas',
}

export const DESTRUCTIVE_GROUP_TITLE = 'Operaciones destructivas'

/** Etiqueta de la marca de las filas con algún scope destructivo. */
export const DESTRUCTIVE_BADGE_LABEL = 'Destructivo'

/** Etiqueta de un scope guardado que el emisor ya no tiene. */
export const SUSPENDED_BADGE_LABEL = 'suspendido'

export const DESTRUCTIVE_ACKNOWLEDGEMENT_LABEL =
  'Entiendo que una integración podrá revertir migraciones y perder datos.'

/**
 * Aviso del tier destructivo. `maxDays` es el tope que informa el servidor
 * (`max_destructive_ttl_days`), nunca un número fijo del cliente.
 */
export function destructiveWarning(maxDays: number): string {
  return `Estos permisos permiten revertir migraciones (ejecuta el down_sql y puede borrar datos de forma irreversible) y marcar versiones sin ejecutar SQL. El token vencerá en ${maxDays} días como máximo, exige una lista de blueprints y no opera en entornos que bloquean migraciones destructivas ni en bases sin entorno.`
}

/** Espera fija sugerida tras un 429: el alta tiene un límite de 10 por minuto. */
export const RATE_LIMIT_HINT =
  'Se alcanzó el límite de solicitudes (10/min al emitir tokens). Esperá unos segundos y volvé a intentarlo.'

/**
 * Copy de los errores del módulo de tokens de integración.
 *
 * Devuelve `null` cuando no reconoce el caso, para que el llamador caiga en `apiError.message` y
 * nunca oculte información al usuario.
 */
export function integrationTokenErrorMessage(error: ApiError): string | null {
  if (error.status === 429) return RATE_LIMIT_HINT

  switch (error.code) {
    case INTEGRATION_TOKEN_ERROR_CODES.disabled:
      return 'La API de integración está apagada en este servidor. Podés listar y revocar tokens, pero no emitirlos ni editarlos.'
    case INTEGRATION_TOKEN_ERROR_CODES.ttlTooLong: {
      const maxDays = error.apiTokenContext?.maxDays
      return maxDays === undefined
        ? 'El vencimiento supera el máximo permitido para esos permisos.'
        : `El vencimiento supera el máximo permitido para esos permisos (${maxDays} días). Si el token ya vive más, emití uno nuevo.`
    }
    case INTEGRATION_TOKEN_ERROR_CODES.scopeNotAllowed:
      return 'Alguno de los permisos ya no está dentro de lo que tu rol puede dar. Cerrá el formulario y volvé a abrirlo para ver los vigentes.'
    case INTEGRATION_TOKEN_ERROR_CODES.unknownScope:
      return 'Hay un permiso que no existe en el vocabulario de integración. Revisá la selección.'
    case INTEGRATION_TOKEN_ERROR_CODES.serverAllowlistRequired:
      return 'Elegí al menos un servidor: un token sin servidores no alcanzaría nada.'
    case INTEGRATION_TOKEN_ERROR_CODES.blueprintAllowlistRequired:
      return 'Los permisos destructivos exigen al menos un blueprint en la lista permitida.'
    case INTEGRATION_TOKEN_ERROR_CODES.serverNotFound:
      return 'Alguno de los servidores elegidos ya no existe. Volvé a abrir el formulario y elegí de nuevo.'
    case INTEGRATION_TOKEN_ERROR_CODES.blueprintNotFound:
      return 'Alguno de los blueprints elegidos ya no existe. Volvé a abrir el formulario y elegí de nuevo.'
    case INTEGRATION_TOKEN_ERROR_CODES.notFound:
      return 'Este token ya no existe, o no es tuyo. Refrescá el listado.'
    case INTEGRATION_TOKEN_ERROR_CODES.alreadyRevoked:
      return 'Este token ya estaba revocado: no fue esta acción la que cortó el acceso.'
    default:
      return null
  }
}
