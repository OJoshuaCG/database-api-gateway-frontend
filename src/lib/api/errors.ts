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

/**
 * Violación del layout manual de un snapshot (Plan 09 §3/§6). El backend solo la incluye en
 * `detail.context.violations` cuando corre en `APP_ENV=development`; en producción la UI se apoya
 * en su validación en cliente + `detail.msg`. `version` es 1-based (posición del bucket). Los
 * campos extra dependen del `reason` (p. ej. `also_in_version`, `dependency_version`).
 */
export interface ManualLayoutViolation {
  reason: string
  /** Mensaje accionable en español ya formateado por el backend (Corrección 2026-07-08). */
  hint?: string
  object?: string
  object_type?: string
  version?: number
  also_in_version?: number
  depends_on?: string
  dependency_version?: number
  must_be_at_most?: number
  must_be_at_least?: number
  first_data_version?: number
  table_structure_version?: number
  [key: string]: unknown
}

/**
 * Tabla de datos omitida reportada dentro del `context` de un error 422 de layout manual
 * (Corrección 2026-07-08): explica por qué una tabla de `data_tables` no llegó a evaluarse.
 */
export interface ContextSkippedTable {
  table: string
  reason: string
}

export class ApiError extends Error {
  /** Status HTTP (0 = error de red / CORS / fetch abortado por el navegador). */
  readonly status: number
  /** Tipo reportado por el backend (`AppHttpException`, `RequestValidationError`, …). */
  readonly type?: string
  /** Errores por campo cuando el status es 422 (modo desarrollo del backend). */
  readonly fieldErrors?: FieldError[]
  /** Violaciones del layout manual (`context.violations`, solo en desarrollo del backend). */
  readonly violations?: ManualLayoutViolation[]
  /** Tablas de datos omitidas antes de validar el layout (`context.skipped_tables`, dev-only). */
  readonly skippedTables?: ContextSkippedTable[]
  /**
   * Versiones del blueprint sin `down_sql` confirmado (`public_context.missing_down_sql` del 409
   * de rollback). A diferencia de `context`, `public_context` viaja siempre, en cualquier entorno.
   */
  readonly missingDownSql?: string[]
  /**
   * Sentencias aplicadas sin reverso conocido (`public_context.unreversible_statements` del 409
   * de `reconcile-partial`, §9). El backend valida `force` ANTES de `dry_run`: este 409 llega
   * incluso en dry-run; la UI reintenta el dry-run con `force=true` para mostrar el plan.
   */
  readonly unreversibleStatements?: string[]
  /**
   * `op_group`s faltantes del 422 "la selección no cierra sus dependencias" de adopt/execute
   * custom en schema-comparisons (`public_context.missing_dependencies`, §10.6).
   */
  readonly missingDependencies?: string[]
  /**
   * Ids de ítems sugeridos por el backend para cerrar la selección
   * (`public_context.suggested_item_ids`, §10.6) — alimentan el CTA "Resolver automáticamente".
   */
  readonly suggestedItemIds?: number[]
  /** `X-Request-ID` de la respuesta, para soporte. Presente en toda respuesta del backend. */
  readonly requestId?: string

  constructor(args: {
    status: number
    message: string
    type?: string
    fieldErrors?: FieldError[]
    violations?: ManualLayoutViolation[]
    skippedTables?: ContextSkippedTable[]
    missingDownSql?: string[]
    unreversibleStatements?: string[]
    missingDependencies?: string[]
    suggestedItemIds?: number[]
    requestId?: string
  }) {
    super(args.message)
    this.name = 'ApiError'
    this.status = args.status
    this.type = args.type
    this.fieldErrors = args.fieldErrors
    this.violations = args.violations
    this.skippedTables = args.skippedTables
    this.missingDownSql = args.missingDownSql
    this.unreversibleStatements = args.unreversibleStatements
    this.missingDependencies = args.missingDependencies
    this.suggestedItemIds = args.suggestedItemIds
    this.requestId = args.requestId
  }

  /** Rate limit del backend excedido (§3, `from-snapshot` 10/min). */
  get isRateLimited(): boolean {
    return this.status === 429
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
  public_context?: unknown
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

/**
 * Extrae `context.violations` (layout manual del snapshot). Solo presente en desarrollo del
 * backend; se conservan todos los campos extra por `reason` para el mapeo accionable en la UI.
 */
function extractViolations(context: unknown): ManualLayoutViolation[] | undefined {
  if (!isRecord(context) || !Array.isArray(context.violations)) return undefined
  const violations: ManualLayoutViolation[] = []
  for (const entry of context.violations) {
    if (isRecord(entry) && typeof entry.reason === 'string') {
      violations.push({ ...(entry as ManualLayoutViolation), reason: entry.reason })
    }
  }
  return violations.length > 0 ? violations : undefined
}

/** Extrae `context.skipped_tables` (tablas de datos descartadas antes de validar el layout). */
function extractSkippedTables(context: unknown): ContextSkippedTable[] | undefined {
  if (!isRecord(context) || !Array.isArray(context.skipped_tables)) return undefined
  const tables: ContextSkippedTable[] = []
  for (const entry of context.skipped_tables) {
    if (isRecord(entry) && typeof entry.table === 'string' && typeof entry.reason === 'string') {
      tables.push({ table: entry.table, reason: entry.reason })
    }
  }
  return tables.length > 0 ? tables : undefined
}

/**
 * Extrae `public_context.missing_down_sql` (versiones sin rollback confirmado, 409 de
 * `.../migrations/rollback`). A diferencia de `context`, `public_context` viaja siempre.
 */
function extractMissingDownSql(publicContext: unknown): string[] | undefined {
  if (!isRecord(publicContext) || !Array.isArray(publicContext.missing_down_sql)) return undefined
  const versions = publicContext.missing_down_sql.filter(
    (v): v is string => typeof v === 'string',
  )
  return versions.length > 0 ? versions : undefined
}

/**
 * Extrae `public_context.unreversible_statements` (409 de `reconcile-partial`, §9): sentencias
 * aplicadas de la migración parcial que no tienen reverso conocido (exigen `force=true`).
 */
function extractUnreversibleStatements(publicContext: unknown): string[] | undefined {
  if (!isRecord(publicContext) || !Array.isArray(publicContext.unreversible_statements)) {
    return undefined
  }
  const statements = publicContext.unreversible_statements.filter(
    (s): s is string => typeof s === 'string',
  )
  return statements.length > 0 ? statements : undefined
}

/**
 * Extrae `public_context.missing_dependencies` (422 de adopt/execute custom en
 * schema-comparisons, §10.6): `op_group`s de los que depende la selección y que no fueron
 * incluidos.
 */
function extractMissingDependencies(publicContext: unknown): string[] | undefined {
  if (!isRecord(publicContext) || !Array.isArray(publicContext.missing_dependencies)) {
    return undefined
  }
  const groups = publicContext.missing_dependencies.filter(
    (g): g is string => typeof g === 'string',
  )
  return groups.length > 0 ? groups : undefined
}

/** Extrae `public_context.suggested_item_ids` (mismo 422 §10.6): ids que cierran la selección. */
function extractSuggestedItemIds(publicContext: unknown): number[] | undefined {
  if (!isRecord(publicContext) || !Array.isArray(publicContext.suggested_item_ids)) {
    return undefined
  }
  const ids = publicContext.suggested_item_ids.filter(
    (id): id is number => typeof id === 'number' && Number.isFinite(id),
  )
  return ids.length > 0 ? ids : undefined
}

/** Construye un `ApiError` a partir del status, el cuerpo parseado y el `X-Request-ID`. */
export function normalizeApiError(status: number, body: unknown, requestId?: string): ApiError {
  const fallback = FALLBACK_BY_STATUS[status] ?? `Error inesperado (HTTP ${status}).`

  if (isRecord(body) && 'detail' in body) {
    const detail = body.detail
    if (typeof detail === 'string' && detail.trim().length > 0) {
      return new ApiError({ status, message: detail, requestId })
    }
    if (isRecord(detail)) {
      const d = detail as DetailObject
      const message = typeof d.msg === 'string' && d.msg.trim().length > 0 ? d.msg : fallback
      const type = typeof d.type === 'string' ? d.type : undefined
      return new ApiError({
        status,
        message,
        type,
        fieldErrors: extractFieldErrors(d.context),
        violations: extractViolations(d.context),
        skippedTables: extractSkippedTables(d.context),
        missingDownSql: extractMissingDownSql(d.public_context),
        unreversibleStatements: extractUnreversibleStatements(d.public_context),
        missingDependencies: extractMissingDependencies(d.public_context),
        suggestedItemIds: extractSuggestedItemIds(d.public_context),
        requestId,
      })
    }
  }

  return new ApiError({ status, message: fallback, requestId })
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
