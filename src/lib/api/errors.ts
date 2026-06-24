/**
 * Normalización de errores de la API a un formato único (`ApiError`).
 *
 * El backend tiene DOS formas de error según la fuente:
 *  - api-reference.md (§3) muestra `{ "detail": "texto" }` (string).
 *  - Los handlers reales (docs/features/exceptions.md) devuelven
 *    `{ "detail": { "msg": string, "type": string, "context"?, "loc"? } }` (objeto).
 * Soportamos ambas de forma defensiva, además de errores de red (status 0).
 */

export interface FieldError {
  field: string
  message: string
}

export class ApiError extends Error {
  /** Status HTTP (0 = error de red / CORS / fetch abortado por el navegador). */
  readonly status: number
  /** Tipo reportado por el backend (`AppHttpException`, `RequestValidationError`, …). */
  readonly type?: string
  /** Errores por campo cuando el status es 422 (modo desarrollo del backend). */
  readonly fieldErrors?: FieldError[]

  constructor(args: {
    status: number
    message: string
    type?: string
    fieldErrors?: FieldError[]
  }) {
    super(args.message)
    this.name = 'ApiError'
    this.status = args.status
    this.type = args.type
    this.fieldErrors = args.fieldErrors
  }

  /** El recurso/credenciales requieren (re)autenticación. */
  get isUnauthorized(): boolean {
    return this.status === 401
  }

  /** Operación contra el motor destino que no se pudo completar (§3 🔌). */
  get isEngineError(): boolean {
    return this.status === 502 || this.status === 504
  }
}

const FALLBACK_BY_STATUS: Record<number, string> = {
  0: 'No se pudo conectar con la API. Revisa tu conexión o la configuración de CORS.',
  400: 'La petición es inválida.',
  401: 'Tu sesión no es válida o ha expirado.',
  403: 'No tienes permisos para esta operación.',
  404: 'El recurso solicitado no existe.',
  409: 'Conflicto: el recurso ya existe o tiene dependencias.',
  422: 'Hay datos inválidos en el formulario.',
  429: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
  502: 'No se pudo conectar con el servidor de base de datos destino.',
  503: 'El servicio no está disponible temporalmente.',
  504: 'La operación en el servidor destino excedió el tiempo de espera.',
}

interface DetailObject {
  msg?: unknown
  type?: unknown
  context?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractFieldErrors(context: unknown): FieldError[] | undefined {
  if (!Array.isArray(context)) return undefined
  const errors: FieldError[] = []
  for (const entry of context) {
    if (isRecord(entry) && typeof entry.field === 'string') {
      errors.push({
        field: entry.field,
        message: typeof entry.msg === 'string' ? entry.msg : 'Inválido',
      })
    }
  }
  return errors.length > 0 ? errors : undefined
}

/** Construye un `ApiError` a partir del status y el cuerpo (ya parseado) de la respuesta. */
export function normalizeApiError(status: number, body: unknown): ApiError {
  const fallback = FALLBACK_BY_STATUS[status] ?? `Error inesperado (HTTP ${status}).`

  if (isRecord(body) && 'detail' in body) {
    const detail = body.detail
    if (typeof detail === 'string' && detail.trim().length > 0) {
      return new ApiError({ status, message: detail })
    }
    if (isRecord(detail)) {
      const d = detail as DetailObject
      const message = typeof d.msg === 'string' && d.msg.trim().length > 0 ? d.msg : fallback
      const type = typeof d.type === 'string' ? d.type : undefined
      return new ApiError({ status, message, type, fieldErrors: extractFieldErrors(d.context) })
    }
  }

  return new ApiError({ status, message: fallback })
}

/** Error de red (fetch rechazado: offline, DNS, CORS preflight bloqueado…). */
export function networkError(): ApiError {
  return new ApiError({ status: 0, message: FALLBACK_BY_STATUS[0]! })
}

/** Convierte cualquier valor capturado en un `ApiError` (para boundaries/handlers). */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof Error) return new ApiError({ status: 0, message: error.message })
  return new ApiError({ status: 0, message: 'Error desconocido.' })
}
