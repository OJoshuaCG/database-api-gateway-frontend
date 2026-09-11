import { API_TOKEN_ERROR_CODES, API_TOKEN_MAX_TTL_DAYS } from '@/lib/contracts'
import type { ApiError } from '@/lib/api/errors'

/** Espera fija sugerida tras un 429. El backend no manda `Retry-After` (§6). */
export const RATE_LIMIT_HINT =
  'Se alcanzó el límite de solicitudes (10/min al emitir tokens). Espera unos segundos y vuelve a intentarlo.'

/**
 * Copy de los errores del módulo de tokens de agente (§3).
 *
 * Devuelve `null` cuando no reconoce el caso, para que el llamador caiga en `apiError.message` y
 * nunca oculte información al usuario.
 */
export function apiTokenErrorMessage(error: ApiError): string | null {
  if (error.status === 429) return RATE_LIMIT_HINT

  switch (error.code) {
    case API_TOKEN_ERROR_CODES.projectRequired:
      return 'Falta el proyecto. Un token sin proyecto no alcanzaría ninguna base de datos.'
    case API_TOKEN_ERROR_CODES.ttlTooLong: {
      const max = error.apiTokenContext?.maxDays ?? API_TOKEN_MAX_TTL_DAYS
      return `El vencimiento supera el máximo permitido (${max} días).`
    }
    case API_TOKEN_ERROR_CODES.scopeNotAllowed: {
      const allowed = error.apiTokenContext?.allowed
      // Sin `allowed[]` el rechazo NO es «fuera del techo de agente» sino un string que no es
      // ninguna capacidad conocida (un typo). Son causas distintas y merecen copy distinto: decir
      // «elige del techo» cuando el problema es un nombre inventado manda a buscar donde no está.
      return allowed?.length
        ? `Alguno de los permisos queda fuera del techo de agente. Admitidos: ${allowed.join(', ')}.`
        : 'Hay un permiso que no corresponde a ninguna capacidad conocida. Revisa la selección.'
    }
    case API_TOKEN_ERROR_CODES.notFound:
      return 'Este token ya no existe. Refresca el listado.'
    case API_TOKEN_ERROR_CODES.alreadyRevoked:
      return 'Este token ya estaba revocado: no fue esta acción la que cortó el acceso.'
    default:
      return null
  }
}
