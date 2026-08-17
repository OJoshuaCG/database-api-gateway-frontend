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
 * Motivo estable por el que la política de la consola SQL clasificó o rechazó una sentencia
 * (`public_context.reasons` del 403, api-reference-v6 §8). Mismo shape que `QueryReasonOut`
 * del contrato Zod, redeclarado aquí para que `lib/api` no dependa de `lib/contracts`.
 */
export interface ApiReason {
  code: string
  message: string
}

/** Sentencia concreta del lote que la política bloqueó (`public_context.blocked_statements`). */
export interface BlockedStatement {
  seq: number
  sql: string
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

/**
 * Opción permitida que el backend sugiere en el 422 "combinación no habilitada"
 * (`public_context.allowed`) del catálogo de charset/collation.
 */
export interface CharsetRejectedAllowedOption {
  charset: string
  collation: string | null
  isDefault: boolean
}

/**
 * Contexto del 422 "combinación no habilitada" al crear/usar una base con un charset/collation
 * que no está en el catálogo (`public_context` de `POST /charset-collation-options` y de la
 * creación de bases que valida contra él).
 */
export interface CharsetRejectedContext {
  engineFamily: string
  requested: { charset: string | null; collation: string | null }
  allowed: CharsetRejectedAllowedOption[]
  truncated: boolean
}

/**
 * Contexto del 409 "la combinación ya existe" al crear una entrada duplicada en el catálogo de
 * charset/collation (`public_context` de `POST /charset-collation-options`).
 */
export interface CharsetDuplicateContext {
  id: number
  engineFamily: string
  charset: string
  collation: string | null
  enabled: boolean
}

/**
 * Contexto del 422 "la collation pedida no existe en este servidor PostgreSQL…" al crear el plan
 * de conversión de collation (`public_context` de `POST .../collation-conversions`). Trae SOLO el
 * conteo de alternativas disponibles; la lista en sí sale de `available_collations` del inventario
 * del plan (`GET .../objects`), no de este error.
 */
export interface PostgresCollationRejectedContext {
  availableCount: number
}

/** Objeto del catálogo referido por un error de exportación (`{object_type, name}`). */
export interface ExportErrorObject {
  objectType: string
  name: string
}

/**
 * Contexto público de un error del módulo de exportación de bases (api-reference-v10 §6). Se
 * agrupa en un solo campo —y no en once campos sueltos de `ApiError`— porque las claves son
 * exclusivas de este módulo y varias colisionan de nombre con las de otros (`missing_dependencies`
 * aquí son objetos `{object_type, name}`, no los `op_group` de schema-comparisons; `reasons` aquí
 * son motivos del filtro de filas, no los de la política de la consola SQL).
 *
 * Todas las claves son opcionales: cada código estable trae solo las suyas.
 */
export interface DatabaseExportErrorContext {
  /** Ruta con puntos del campo culpable (`structure.entity_ddl`, `output.delivery`, …). */
  field?: string
  /** Todos los campos culpables cuando la regla de compatibilidad señala más de uno. */
  fields?: string[]
  /** Valores admitidos para `field` (la whitelist de `file_encoding`, `["NONE"]`, …). */
  allowed?: string[]
  /** Tokens no reconocidos en `output.filename_template`. */
  unknownTokens?: string[]
  /** Tablas con datos pedidos cuya estructura quedó fuera (`export.data_without_structure`). */
  dataWithoutStructure?: string[]
  /** Dependencias que la selección explícita no cierra (`export.missing_dependencies`). */
  missingDependencies?: ExportErrorObject[]
  /** Nombres que el backend sugiere para cerrar la selección (mismo 422). */
  suggestedNames?: string[]
  /** Tabla cuyo filtro `where` fue rechazado (`export.invalid_row_filter`). */
  table?: string
  /** Motivo estable del rechazo del filtro de filas (vocabulario cerrado, §6.3). */
  reason?: string
  /** Motivos adicionales del mismo rechazo, cuando el backend detecta más de uno. */
  filterReasons?: string[]
  /** Fragmento peligroso detectado en el filtro de filas. */
  danger?: string
  /**
   * Tope numérico del contexto. Su significado depende del código: longitud máxima del filtro en
   * `export.invalid_row_filter`, y máximo de exportaciones concurrentes en `export.quota_exceeded`.
   */
  limit?: number
  /** Exportaciones admitidas (en cola + en ejecución) al rechazar por cuota. */
  running?: number
  /** Tamaño real del artefacto que no cabe en la entrega en línea (`export.inline_too_large`). */
  byteSize?: number
  /** Tope de la entrega en línea, en bytes (mismo 409). */
  inlineMaxBytes?: number
  /** Id del plan original cuya `idempotency_key` se reutilizó con otro spec (409). */
  exportJobId?: number
  /** Estado del job que impide la operación (`already_executed`, `not_ready`, `not_cancellable`). */
  jobStatus?: string
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
  /**
   * Versiones con captura de resultados de SELECT SIN REVISAR que bloquean
   * `apply`/`apply-all`/`rollback`/`stamp` (`public_context.unreviewed_capture`,
   * api-reference-v9 §3.0). Alcance acotado a la llamada (§2.2), no todo el blueprint.
   */
  readonly unreviewedCapture?: string[]
  /**
   * Versiones con `capture_selects` activo en el camino de esta corrida que exigen
   * `allow_result_capture=true` (`public_context.capture_versions`, api-reference-v9 §3.0).
   * Puede ser un subconjunto de las pendientes/a revertir.
   */
  readonly captureVersions?: string[]
  /**
   * Motivos de la política de la consola SQL (`public_context.reasons` del 403, v6 §9.2).
   * Idealmente este 403 nunca se ve —el preview ya devolvió `blocked: true`—, pero es la
   * segunda barrera y la ÚNICA que detecta `system_database_write`.
   */
  readonly reasons?: ApiReason[]
  /** Sentencias bloqueadas del lote (`public_context.blocked_statements`, v6 §9.2). */
  readonly blockedStatements?: BlockedStatement[]
  /**
   * 422 "combinación no habilitada" del catálogo de charset/collation: la combinación pedida no
   * está en `charset-collation-options`; trae las alternativas permitidas para esa familia.
   */
  readonly charsetRejected?: CharsetRejectedContext
  /**
   * 409 "la combinación ya existe" al crear una entrada duplicada en el catálogo de
   * charset/collation (`POST /charset-collation-options`).
   */
  readonly charsetDuplicate?: CharsetDuplicateContext
  /**
   * 422 "la collation pedida no existe en este servidor PostgreSQL…" al crear el plan de
   * conversión de collation (`POST .../collation-conversions`).
   */
  readonly postgresCollationRejected?: PostgresCollationRejectedContext
  /**
   * `public_context.code`: identificador estable del fallo, independiente del texto del mensaje y
   * visible **también en producción** (a diferencia de `context`, que solo existe en desarrollo).
   * Es la única forma fiable de clasificar un error para decidir el CTA de recuperación.
   */
  readonly code?: string
  /** Contexto del módulo de exportación de bases (api-reference-v10 §6). */
  readonly exportContext?: DatabaseExportErrorContext
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
    unreviewedCapture?: string[]
    captureVersions?: string[]
    reasons?: ApiReason[]
    blockedStatements?: BlockedStatement[]
    charsetRejected?: CharsetRejectedContext
    charsetDuplicate?: CharsetDuplicateContext
    postgresCollationRejected?: PostgresCollationRejectedContext
    code?: string
    exportContext?: DatabaseExportErrorContext
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
    this.unreviewedCapture = args.unreviewedCapture
    this.captureVersions = args.captureVersions
    this.reasons = args.reasons
    this.blockedStatements = args.blockedStatements
    this.charsetRejected = args.charsetRejected
    this.charsetDuplicate = args.charsetDuplicate
    this.postgresCollationRejected = args.postgresCollationRejected
    this.code = args.code
    this.exportContext = args.exportContext
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
  const versions = publicContext.missing_down_sql.filter((v): v is string => typeof v === 'string')
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

/**
 * Extrae `public_context.unreviewed_capture` (409 de captura sin revisar en
 * `apply`/`apply-all`/`rollback`/`stamp`, api-reference-v9 §3.0). A diferencia del resto del
 * gateway, este `public_context` viaja en TODOS los ambientes, no solo en desarrollo.
 */
function extractUnreviewedCapture(publicContext: unknown): string[] | undefined {
  if (!isRecord(publicContext) || !Array.isArray(publicContext.unreviewed_capture)) {
    return undefined
  }
  const versions = publicContext.unreviewed_capture.filter(
    (v): v is string => typeof v === 'string',
  )
  return versions.length > 0 ? versions : undefined
}

/**
 * Extrae `public_context.capture_versions` (409 de falta de `allow_result_capture` en
 * `apply`/`apply-all`/`rollback`, api-reference-v9 §3.0). Viaja en todos los ambientes.
 */
function extractCaptureVersions(publicContext: unknown): string[] | undefined {
  if (!isRecord(publicContext) || !Array.isArray(publicContext.capture_versions)) {
    return undefined
  }
  const versions = publicContext.capture_versions.filter((v): v is string => typeof v === 'string')
  return versions.length > 0 ? versions : undefined
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

/**
 * Extrae `public_context.reasons` (403 de la consola SQL, v6 §9.2). El `code` es estable y
 * la UI lo mapea a tono y enlace; el `message` ya viene redactado en español.
 */
function extractReasons(publicContext: unknown): ApiReason[] | undefined {
  if (!isRecord(publicContext) || !Array.isArray(publicContext.reasons)) return undefined
  const reasons: ApiReason[] = []
  for (const entry of publicContext.reasons) {
    if (isRecord(entry) && typeof entry.code === 'string' && typeof entry.message === 'string') {
      reasons.push({ code: entry.code, message: entry.message })
    }
  }
  return reasons.length > 0 ? reasons : undefined
}

/** Extrae `public_context.blocked_statements` (403 de la consola SQL, v6 §9.2). */
function extractBlockedStatements(publicContext: unknown): BlockedStatement[] | undefined {
  if (!isRecord(publicContext) || !Array.isArray(publicContext.blocked_statements)) {
    return undefined
  }
  const statements: BlockedStatement[] = []
  for (const entry of publicContext.blocked_statements) {
    if (isRecord(entry) && typeof entry.seq === 'number' && typeof entry.sql === 'string') {
      statements.push({ seq: entry.seq, sql: entry.sql })
    }
  }
  return statements.length > 0 ? statements : undefined
}

/**
 * Extrae `public_context.allowed` (422 "combinación no habilitada" del catálogo de
 * charset/collation): alternativas permitidas para la familia de motor pedida.
 */
function extractCharsetRejectedAllowed(allowed: unknown): CharsetRejectedAllowedOption[] {
  if (!Array.isArray(allowed)) return []
  const options: CharsetRejectedAllowedOption[] = []
  for (const entry of allowed) {
    if (isRecord(entry) && typeof entry.charset === 'string') {
      options.push({
        charset: entry.charset,
        collation: typeof entry.collation === 'string' ? entry.collation : null,
        isDefault: entry.is_default === true,
      })
    }
  }
  return options
}

/**
 * Extrae `public_context` del 422 "combinación no habilitada" al crear/usar una base con un
 * charset/collation que no está en el catálogo (`charset-collation-options`).
 */
function extractCharsetRejected(publicContext: unknown): CharsetRejectedContext | undefined {
  if (!isRecord(publicContext)) return undefined
  if (typeof publicContext.engine_family !== 'string') return undefined
  const requested = publicContext.requested
  if (!isRecord(requested)) return undefined
  return {
    engineFamily: publicContext.engine_family,
    requested: {
      charset: typeof requested.charset === 'string' ? requested.charset : null,
      collation: typeof requested.collation === 'string' ? requested.collation : null,
    },
    allowed: extractCharsetRejectedAllowed(publicContext.allowed),
    truncated: publicContext.truncated === true,
  }
}

/**
 * Extrae `public_context` del 409 "la combinación ya existe" al crear una entrada duplicada en
 * el catálogo de charset/collation (`POST /charset-collation-options`).
 */
function extractCharsetDuplicate(publicContext: unknown): CharsetDuplicateContext | undefined {
  if (!isRecord(publicContext)) return undefined
  if (
    typeof publicContext.id !== 'number' ||
    typeof publicContext.engine_family !== 'string' ||
    typeof publicContext.charset !== 'string' ||
    typeof publicContext.enabled !== 'boolean'
  ) {
    return undefined
  }
  return {
    id: publicContext.id,
    engineFamily: publicContext.engine_family,
    charset: publicContext.charset,
    collation: typeof publicContext.collation === 'string' ? publicContext.collation : null,
    enabled: publicContext.enabled,
  }
}

/**
 * Extrae `public_context.available_count` (422 "la collation pedida no existe…" al crear el plan
 * de conversión de collation en PostgreSQL). Solo el conteo; la lista sale de `available_collations`.
 */
function extractPostgresCollationRejected(
  publicContext: unknown,
): PostgresCollationRejectedContext | undefined {
  if (!isRecord(publicContext) || typeof publicContext.available_count !== 'number') {
    return undefined
  }
  if (!Number.isFinite(publicContext.available_count)) return undefined
  return { availableCount: publicContext.available_count }
}

/** Extrae `public_context.code`: el identificador estable del fallo, presente en producción. */
function extractCode(publicContext: unknown): string | undefined {
  if (!isRecord(publicContext) || typeof publicContext.code !== 'string') return undefined
  return publicContext.code.trim().length > 0 ? publicContext.code : undefined
}

/** Filtra un array desconocido dejando solo sus cadenas; `undefined` si no queda ninguna. */
function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items : undefined
}

/** Lee una clave numérica finita de un `public_context`. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Lee una clave de texto no vacía de un `public_context`. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/**
 * Extrae la lista `[{object_type, name}]` de dependencias sin cerrar del módulo de exportación.
 * Deliberadamente distinta de `extractMissingDependencies` (schema-comparisons), donde la misma
 * clave transporta `op_group`s en texto plano.
 */
function extractExportObjects(value: unknown): ExportErrorObject[] | undefined {
  if (!Array.isArray(value)) return undefined
  const objects: ExportErrorObject[] = []
  for (const entry of value) {
    if (
      isRecord(entry) &&
      typeof entry.object_type === 'string' &&
      typeof entry.name === 'string'
    ) {
      objects.push({ objectType: entry.object_type, name: entry.name })
    }
  }
  return objects.length > 0 ? objects : undefined
}

/**
 * Extrae el `public_context` de un error del módulo de exportación (api-reference-v10 §6). Solo se
 * construye cuando el `code` pertenece al módulo: así un `field`/`limit` de cualquier otro endpoint
 * no acaba disfrazado de contexto de exportación.
 */
function extractDatabaseExportContext(
  code: string | undefined,
  publicContext: unknown,
): DatabaseExportErrorContext | undefined {
  if (!code?.startsWith('export.') || !isRecord(publicContext)) return undefined

  const context: DatabaseExportErrorContext = {
    field: nonEmptyString(publicContext.field),
    fields: stringList(publicContext.fields),
    allowed: stringList(publicContext.allowed),
    unknownTokens: stringList(publicContext.unknown_tokens),
    dataWithoutStructure: stringList(publicContext.data_without_structure),
    missingDependencies: extractExportObjects(publicContext.missing_dependencies),
    suggestedNames: stringList(publicContext.suggested_names),
    table: nonEmptyString(publicContext.table),
    reason: nonEmptyString(publicContext.reason),
    filterReasons: stringList(publicContext.reasons),
    danger: nonEmptyString(publicContext.danger),
    limit: finiteNumber(publicContext.limit),
    running: finiteNumber(publicContext.running),
    byteSize: finiteNumber(publicContext.byte_size),
    inlineMaxBytes: finiteNumber(publicContext.inline_max_bytes),
    exportJobId: finiteNumber(publicContext.export_job_id),
    jobStatus: nonEmptyString(publicContext.status),
  }

  // Un contexto sin ninguna clave útil no aporta nada sobre el `code`, que ya viaja aparte.
  return Object.values(context).some((value) => value !== undefined) ? context : undefined
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
      const code = extractCode(d.public_context)
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
        unreviewedCapture: extractUnreviewedCapture(d.public_context),
        captureVersions: extractCaptureVersions(d.public_context),
        reasons: extractReasons(d.public_context),
        blockedStatements: extractBlockedStatements(d.public_context),
        charsetRejected: extractCharsetRejected(d.public_context),
        charsetDuplicate: extractCharsetDuplicate(d.public_context),
        postgresCollationRejected: extractPostgresCollationRejected(d.public_context),
        code,
        exportContext: extractDatabaseExportContext(code, d.public_context),
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
