import { z } from 'zod'
import { engineTypeSchema, type EngineType } from './common'

/**
 * Consola SQL: ejecutar SQL ad-hoc eligiendo el usuario del motor (`api-reference-v6.md`).
 *
 * El módulo existe para VERIFICAR permisos, no para operar: la identidad con la que se
 * ejecuta viaja en el request (`connection.mode`) porque elegirla *es* la funcionalidad.
 * De ahí que el rechazo del motor sea un resultado válido (HTTP 200 + `success: false`) y
 * no un error de la API.
 *
 * ⚠️ Regla de serialización del backend: dentro de `data` los opcionales llegan como `null`
 * EXPLÍCITO, nunca ausentes. Por eso van `.nullable()` y no solo `.optional()`.
 *
 * ⚠️ Estado del backend (§2.8 del contrato): el módulo aún no se validó contra motores
 * reales, así que el contrato puede tener ajustes menores. Todo el mapeo de la respuesta
 * está aislado aquí y en `features/sql-console/logic.ts` para que el ajuste sea local.
 */

// ── Enums (§12) ───────────────────────────────────────────────────────────────

/**
 * Nivel de peligro de una sentencia; el del lote es el MÁXIMO de sus sentencias.
 * `ddl` incluye todo lo que el backend no supo reconocer con certeza (política fail-closed),
 * así que NO equivale a "destruye datos" — ver `reasons[]` para el matiz.
 */
export const dangerLevelSchema = z.enum(['read', 'write', 'ddl', 'blocked'])
export type DangerLevel = z.infer<typeof dangerLevelSchema>

export const connectionModeSchema = z.enum(['admin', 'stored', 'provided', 'impersonate'])
export type ConnectionMode = z.infer<typeof connectionModeSchema>

/** `preview` está definido en el modelo del backend pero hoy no se escribe nunca. */
export const historyStatusSchema = z.enum(['success', 'error', 'blocked', 'preview'])
export type HistoryStatus = z.infer<typeof historyStatusSchema>

// ── Topes del despliegue (§2.3) ───────────────────────────────────────────────

/**
 * Defaults de los topes configurables del backend. Se replican para poder avisar en el
 * cliente ANTES de gastar un request (un SQL de 300 KB solo puede terminar en 422). Si el
 * despliegue los cambia, el desfase es benigno: el backend sigue siendo la autoridad.
 */
export const QUERY_LIMITS = {
  /** `QUERY_MAX_ROWS`. `max_rows` del request solo puede BAJARLO. */
  maxRows: 1000,
  /** `QUERY_TIMEOUT_MS`. */
  defaultTimeoutMs: 30_000,
  /** `QUERY_MAX_TIMEOUT_MS`: techo de `timeout_ms`. */
  maxTimeoutMs: 300_000,
  /** Mínimo aceptado por el backend para `timeout_ms`. */
  minTimeoutMs: 100,
  /** `QUERY_MAX_SQL_BYTES`: si se excede → 422. Se mide en BYTES UTF-8, no en caracteres. */
  maxSqlBytes: 262_144,
  /** TTL nominal del `confirm_token`. `expires_at` sigue siendo la fuente de verdad. */
  confirmTokenTtlMs: 120_000,
} as const

/**
 * Bases de datos de sistema del motor. Leerlas está permitido; escribirlas la rechaza un
 * guard que **solo corre en el execute** (403 `system_database_write`), no en el preview.
 * Se replican aquí para deshabilitar la escritura en el cliente y no llevar al usuario a
 * tipear el nombre de la base para acabar en un callejón sin salida.
 *
 * Coincide con `RESERVED_DATABASE_NAMES` de `server-databases`, pero se declara aparte
 * porque el guard es de otro módulo del backend y podría divergir.
 */
export const SYSTEM_DATABASES: Record<EngineType, readonly string[]> = {
  mysql: ['mysql', 'information_schema', 'performance_schema', 'sys'],
  mariadb: ['mysql', 'information_schema', 'performance_schema', 'sys'],
  postgresql: ['postgres', 'template0', 'template1'],
}

// ── Identidad de ejecución (§4) ───────────────────────────────────────────────

/**
 * `QueryConnectionIn`. El backend ata el `confirm_token` a `(hash del SQL, mode, username,
 * role, host)`: cualquier cambio aquí invalida el token emitido por el preview (→ 422).
 * `password` NO forma parte de esa ligadura y NUNCA se persiste (ni backend ni cliente).
 */
export const queryConnectionInSchema = z.object({
  mode: connectionModeSchema,
  /** `stored` | `provided`. */
  username: z.string().nullable().optional(),
  /** Solo `stored` en MySQL/MariaDB: `'app'@'localhost'` y `'app'@'%'` son cuentas DISTINTAS. */
  host: z.string().nullable().optional(),
  /** Solo `provided`. Vive en memoria mientras dura la pantalla; jamás en almacenamiento. */
  password: z.string().nullable().optional(),
  /** Solo `impersonate` (PostgreSQL). En MySQL/MariaDB el backend responde 422. */
  role: z.string().nullable().optional(),
})
export type QueryConnectionIn = z.infer<typeof queryConnectionInSchema>

// ── Motivos de clasificación (§8) ─────────────────────────────────────────────

/**
 * `code` es ESTABLE y se mapea a icono/tono/enlace en `features/sql-console/messages.ts`;
 * `message` viene redactado en español por el backend y sirve de fallback para códigos
 * nuevos que el frontend todavía no conozca.
 */
export const queryReasonOutSchema = z.object({
  code: z.string(),
  message: z.string(),
})
export type QueryReasonOut = z.infer<typeof queryReasonOutSchema>

// ── Preview (§5) ──────────────────────────────────────────────────────────────

export const queryPreviewInSchema = z.object({
  database: z.string().min(1).max(128),
  sql: z.string().min(1),
  connection: queryConnectionInSchema.optional(),
  /** `true` (default) abre conexión al motor para los `SELECT COUNT(*)` de estimación. */
  estimate_impact: z.boolean().optional(),
})
export type QueryPreviewIn = z.infer<typeof queryPreviewInSchema>

export const queryStatementPlanOutSchema = z.object({
  seq: z.number().int(),
  /** La sentencia tal como quedó al separar el lote (sin el `;`). */
  sql: z.string(),
  /**
   * `select`, `update`, `drop`, `unknown`… Conjunto ABIERTO a propósito: es solo
   * iconografía y no queremos que un `kind` nuevo del backend rompa la validación Zod.
   * Quien manda para las decisiones de UI es `danger`.
   */
  kind: z.string(),
  danger: dangerLevelSchema,
  reasons: z.array(queryReasonOutSchema),
  /**
   * Filas que afectaría un `UPDATE`/`DELETE` de UNA sola tabla, contadas con la MISMA
   * credencial que ejecutaría la sentencia. `null` NO relaja nada: significa "no hay cifra
   * exacta que mostrar" (el WHERE cruza tablas, o el usuario elegido no puede leerla).
   */
  estimated_rows: z.number().int().nullable().optional(),
})
export type QueryStatementPlanOut = z.infer<typeof queryStatementPlanOutSchema>

export const queryPreviewOutSchema = z.object({
  server_id: z.number().int(),
  database: z.string(),
  engine: engineTypeSchema,
  /** Usuario del motor con el que se ejecutaría. */
  run_as: z.string(),
  connection_mode: connectionModeSchema,
  danger: dangerLevelSchema,
  /**
   * ⚠️ Un lote BLOQUEADO vuelve con `blocked: true` Y `requires_confirmation: true` a la vez,
   * y `confirm_token: null`. Hay que evaluar `blocked` PRIMERO (ver `decidePath` en `logic.ts`).
   *
   * Además refleja el flag de despliegue `QUERY_SAFE_MODE`: con el modo seguro apagado, un
   * lote `write` puede volver con `requires_confirmation: false` pero CON token igualmente.
   */
  requires_confirmation: z.boolean(),
  blocked: z.boolean(),
  statements: z.array(queryStatementPlanOutSchema),
  /** Motivos agregados del LOTE. */
  reasons: z.array(queryReasonOutSchema),
  /** Textos ya redactados por el backend: se muestran TAL CUAL, sin traducir. */
  warnings: z.array(z.string()),
  /** `null` si no hace falta confirmar, o si el lote está bloqueado. */
  confirm_token: z.string().nullable().optional(),
  /** ISO 8601. TTL de 2 minutos; pasado eso el execute responde 410. */
  expires_at: z.string().nullable().optional(),
})
export type QueryPreviewOut = z.infer<typeof queryPreviewOutSchema>

// ── Execute (§6) ──────────────────────────────────────────────────────────────

export const queryExecuteInSchema = z.object({
  database: z.string().min(1).max(128),
  /** EXACTAMENTE el mismo texto que se envió al preview (el token va atado a su hash). */
  sql: z.string().min(1),
  /** La MISMA identidad que en el preview (modo, usuario, host, rol). */
  connection: queryConnectionInSchema.optional(),
  confirm_token: z.string().nullable().optional(),
  /** Debe ser IDÉNTICO a `database` (igualdad estricta, sensible a mayúsculas). */
  confirm_target_name: z.string().nullable().optional(),
  /** Ejecuta y revierte. Ojo: no revierte DDL en MySQL/MariaDB (§2.5). */
  dry_run: z.boolean().optional(),
  max_rows: z.number().int().min(1).nullable().optional(),
  timeout_ms: z.number().int().min(QUERY_LIMITS.minTimeoutMs).nullable().optional(),
})
export type QueryExecuteIn = z.infer<typeof queryExecuteInSchema>

/** Error NATIVO del motor, sin traducir: es justo el texto que se quiere leer al probar. */
export const queryErrorOutSchema = z.object({
  /** Errno de MySQL/MariaDB o SQLSTATE de PostgreSQL. */
  code: z.string().nullable().optional(),
  sqlstate: z.string().nullable().optional(),
  message: z.string(),
})
export type QueryErrorOut = z.infer<typeof queryErrorOutSchema>

export const queryStatementResultOutSchema = z.object({
  seq: z.number().int(),
  /**
   * El SQL REALMENTE ejecutado: puede diferir del enviado porque a un `SELECT` sin `LIMIT`
   * propio se le empuja `LIMIT <max_rows + 1>` al motor. Se muestra este, no el original.
   */
  sql: z.string(),
  kind: z.string(),
  danger: dangerLevelSchema,
  /** `false` = no llegó a correr: una sentencia anterior del lote falló y se detuvo ahí. */
  executed: z.boolean(),
  success: z.boolean(),
  duration_ms: z.number(),
  columns: z.array(z.string()),
  /** Valores ya normalizados a JSON por el backend (fechas ISO, Decimal como string, …). */
  rows: z.array(z.array(z.unknown())),
  row_count: z.number().int(),
  rows_affected: z.number().int().nullable().optional(),
  /** Había más filas de las devueltas. Callarlo lleva a conclusiones falsas. */
  truncated: z.boolean(),
  /**
   * El gateway la clasificó como lectura y en realidad escribía: la transacción de solo
   * lectura del motor la abortó. Es un BUG DEL GATEWAY, no del usuario.
   */
  policy_miss: z.boolean(),
  error: queryErrorOutSchema.nullable().optional(),
})
export type QueryStatementResultOut = z.infer<typeof queryStatementResultOutSchema>

export const queryExecuteOutSchema = z.object({
  server_id: z.number().int(),
  database: z.string(),
  engine: engineTypeSchema,
  run_as: z.string(),
  connection_mode: connectionModeSchema,
  danger: dangerLevelSchema,
  /** `false` = el MOTOR rechazó alguna sentencia. La respuesta HTTP sigue siendo 200. */
  success: z.boolean(),
  read_only: z.boolean(),
  dry_run: z.boolean(),
  committed: z.boolean(),
  rolled_back: z.boolean(),
  /**
   * A pesar de `rolled_back: true`, quedaron cambios de ESQUEMA aplicados (commit implícito
   * del DDL en MySQL/MariaDB). Es el dato más importante de toda la pantalla de resultados.
   */
  ddl_persisted: z.boolean(),
  statements: z.array(queryStatementResultOutSchema),
  /** No se pudo NI conectar con la credencial elegida. Con `stored`/`provided` es un resultado. */
  connection_error: queryErrorOutSchema.nullable().optional(),
  warnings: z.array(z.string()),
  /** Id de la fila del historial. `null` si el registro (best-effort) falló. */
  execution_id: z.number().int().nullable().optional(),
})
export type QueryExecuteOut = z.infer<typeof queryExecuteOutSchema>

// ── Historial (§7) ────────────────────────────────────────────────────────────

/**
 * Metadatos, NUNCA datos: el gateway no es custodio de las filas del usuario final. Por eso
 * el historial es bitácora + atajo de re-ejecución, jamás caché de resultados.
 */
export const queryHistoryOutSchema = z.object({
  id: z.number().int(),
  server_id: z.number().int(),
  database_name: z.string(),
  engine: engineTypeSchema,
  /** Quién lo corrió desde el gateway. Puede ser `null`. */
  admin_username: z.string().nullable().optional(),
  connection_mode: connectionModeSchema,
  run_as_username: z.string(),
  impersonated_role: z.string().nullable().optional(),
  /** El lote completo, con literales de contraseña reemplazados por `'***'`, recortado a 16 KB. */
  sql_text: z.string(),
  danger_level: dangerLevelSchema,
  statement_count: z.number().int(),
  /** `error` incluye "el motor rechazó por permisos"; `blocked` = nunca se tocó el motor. */
  status: historyStatusSchema,
  read_only: z.boolean(),
  dry_run: z.boolean(),
  committed: z.boolean(),
  rows_returned: z.number().int(),
  rows_affected: z.number().int(),
  duration_ms: z.number(),
  error_code: z.string().nullable().optional(),
  /** En las filas `blocked` trae los motivos concatenados. */
  error_message: z.string().nullable().optional(),
  created_at: z.string(),
})
export type QueryHistoryOut = z.infer<typeof queryHistoryOutSchema>
