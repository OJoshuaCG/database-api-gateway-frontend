import { z } from 'zod'
import { engineTypeSchema, type EngineType } from './common'

/**
 * Ciclo de vida de bases de datos a NIVEL SERVIDOR (`/servers/{id}/databases`).
 *
 * A diferencia de `managed-databases`, este módulo opera por identidad FÍSICA
 * `(server_id, database)`: funciona igual con una BD registrada en el inventario del gateway
 * y con una que el gateway nunca adoptó. El inventario aparece solo como información cruzada
 * (`is_managed`, `managed_database_id`) y como efecto secundario opcional (`register: true`).
 *
 * ⚠️ Regla de serialización del backend: la exclusión de campos `null` opera SOLO sobre las
 * claves del envelope (`data`/`message`/`pagination`), no sobre los campos anidados. Dentro de
 * `data`, un opcional sin valor llega como `null` EXPLÍCITO, nunca ausente. Por eso los campos
 * opcionales se declaran `.nullable()` (no solo `.optional()`).
 */

// ── Metadatos de motor que el backend no expone por API ─────────────────────

/**
 * Bases de datos del sistema, bloqueadas por el guard `ensure_not_reserved_database` al crear
 * y al borrar (→ 409). No hay endpoint que las exponga, así que se replican aquí para poder
 * bloquear el nombre en el formulario antes de gastar un request. La comparación es en
 * minúsculas. Si el backend ampliara la lista, el 409 sigue protegiendo: el desfase es benigno.
 */
export const RESERVED_DATABASE_NAMES: Record<EngineType, readonly string[]> = {
  mysql: ['information_schema', 'mysql', 'performance_schema', 'sys'],
  mariadb: ['information_schema', 'mysql', 'performance_schema', 'sys'],
  postgresql: ['postgres', 'template0', 'template1'],
}

/**
 * Longitud máxima del nombre de una BD a CREAR.
 *
 * El backend aplica DOS validaciones: la whitelist estricta de `validate_identifier`
 * (`^[A-Za-z_][A-Za-z0-9_]{0,62}$` → 63 caracteres como mucho, para cualquier motor) y un
 * límite por motor (mysql/mariadb 64, postgresql 63). Como ambas deben pasar, el techo real
 * es **63 en los tres motores**: un nombre de 64 caracteres es rechazado por la regex incluso
 * en MySQL. Se limita a 63 para no ofrecer al admin un nombre que la API va a rechazar.
 */
export const MAX_DATABASE_NAME_LENGTH = 63

/** Whitelist ESTRICTA del backend, aplicada solo a los nombres a CREAR (`allow_existing=False`). */
export const DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/

/**
 * Whitelist AMPLIADA (`allow_existing=True`): admite nombres legados con `$`, `.` y `-`. Es la
 * que aplica el backend al LEER grantees y al BORRAR. Consecuencia: la UI puede tener que
 * borrar bases cuyo nombre no podría crear, así que el campo "escribe el nombre para
 * confirmar" NO debe aplicar la whitelist estricta, solo igualdad exacta.
 */
export const EXISTING_DATABASE_NAME_PATTERN = /^[A-Za-z0-9_$][A-Za-z0-9_$.-]{0,62}$/

// ── Creación (§3.1) ─────────────────────────────────────────────────────────

/**
 * `DatabaseCreateIn`. `charset`/`collation` cambian de significado según el motor:
 * MySQL/MariaDB → `CHARACTER SET` / `COLLATE`; PostgreSQL → `ENCODING` / `LOCALE`
 * (`LC_COLLATE` + `LC_CTYPE`).
 */
export const databaseCreateInSchema = z.object({
  name: z.string().min(1, 'Requerido').max(MAX_DATABASE_NAME_LENGTH),
  charset: z.string().nullable().optional(),
  collation: z.string().nullable().optional(),
  /**
   * Rol NATIVO de PostgreSQL que será dueño de la base. Ignorado en MySQL/MariaDB, e ignorado
   * también cuando `register=true` (en ese modo el backend usa el username del ServerUser de
   * `owner_id`). No confundir con `owner_id`, que es una PK del inventario del gateway.
   */
  owner: z.string().nullable().optional(),
  /** Alias de API de `register_inventory`. El frontend envía SIEMPRE la clave `register`. */
  register: z.boolean().optional(),
  /** Obligatorio si `register=true` (si falta → 422). Debe ser un ServerUser del MISMO servidor. */
  owner_id: z.number().int().nullable().optional(),
  /** Solo se persiste con `register=true`; ignorado en caso contrario. */
  notes: z.string().nullable().optional(),
})
export type DatabaseCreateIn = z.infer<typeof databaseCreateInSchema>

export const databaseCreateOutSchema = z.object({
  database: z.string(),
  engine: engineTypeSchema,
  registered: z.boolean(),
  /** Número solo si `registered=true`; llega como `null` explícito en caso contrario. */
  managed_database_id: z.number().int().nullable().optional(),
})
export type DatabaseCreateOut = z.infer<typeof databaseCreateOutSchema>

// ── Borrado, paso 1: preview (§3.2) ─────────────────────────────────────────

/**
 * `DropPreviewOut`. No borra nada: valida, informa y emite un `confirm_token` firmado con TTL
 * de 2 minutos. `warnings` viene ya redactado en español por el backend y se muestra TAL CUAL.
 */
export const dropPreviewOutSchema = z.object({
  database: z.string(),
  engine: engineTypeSchema,
  active_connections: z.number().int(),
  is_managed: z.boolean(),
  managed_database_id: z.number().int().nullable().optional(),
  /** Formato `{epoch}.{hmac_hex}`. Ligado a `(server_id, database)`: no sirve cruzado. */
  confirm_token: z.string(),
  /** ISO 8601 en UTC. Única fuente de verdad del vencimiento (el TTL corre en el servidor). */
  expires_at: z.string(),
  warnings: z.array(z.string()).optional(),
})
export type DropPreviewOut = z.infer<typeof dropPreviewOutSchema>

// ── Borrado, paso 2: DELETE irreversible (§3.3) ─────────────────────────────

export const databaseDropInSchema = z.object({
  /** Igualdad EXACTA (case-sensitive) con el nombre real de la BD; si no → 422. */
  confirm_target_name: z.string().min(1, 'Requerido'),
  /** El emitido por el preview, sin modificar. Inválido → 422 · Expirado → 410. */
  confirm_token: z.string().min(1, 'Requerido'),
  /** PostgreSQL: termina las sesiones antes del DROP. MySQL/MariaDB: no-op por paridad. */
  force_disconnect: z.boolean().optional(),
})
export type DatabaseDropIn = z.infer<typeof databaseDropInSchema>

export const databaseDropOutSchema = z.object({
  database: z.string(),
  engine: engineTypeSchema,
  dropped: z.boolean(),
  inventory_removed: z.boolean(),
  /**
   * Conteo INFORMATIVO tomado ANTES del DROP y solo si se envió `force_disconnect=true`; con
   * `force_disconnect=false` vale 0 aunque hubiera conexiones. Es "conexiones terminadas por
   * esta operación", no "conexiones que estaban abiertas".
   */
  terminated_connections: z.number().int().optional(),
})
export type DatabaseDropOut = z.infer<typeof databaseDropOutSchema>

// ── Usuarios/roles con permisos sobre la BD (§3.4) ──────────────────────────

/** Cruce con el inventario. No existe `orphan`: la consulta parte de los grantees del motor. */
export const granteeStatusSchema = z.enum(['adopted', 'unmanaged'])
export type GranteeStatus = z.infer<typeof granteeStatusSchema>

export const databaseGranteeSchema = z.object({
  username: z.string(),
  /** `%` u host concreto en MySQL/MariaDB; SIEMPRE `null` en PostgreSQL (un rol no tiene host). */
  host: z.string().nullable().optional(),
  /**
   * `true` solo en MySQL/MariaDB: el grantee tiene privilegios `*.*` que alcanzan a TODAS las
   * bases. Se incluyen a propósito: tienen acceso efectivo aunque no tengan grant directo.
   */
  is_global: z.boolean().optional(),
  /** Tokens del motor, ya ordenados. En PostgreSQL puede incluir el pseudo-privilegio `OWNER`. */
  privileges: z.array(z.string()),
  /** MySQL/MariaDB: global|database|table|column · PostgreSQL: database|table. */
  levels: z.array(z.string()),
  status: granteeStatusSchema,
  /** Número si `status=adopted`; `null` explícito si `unmanaged`. */
  server_user_id: z.number().int().nullable().optional(),
})
export type DatabaseGrantee = z.infer<typeof databaseGranteeSchema>

/** Lista NO paginada y ya ordenada por `(username, host)`: filtros y orden son del cliente. */
export const databaseGranteesOutSchema = z.object({
  dialect: engineTypeSchema,
  /** `false` en PostgreSQL → la UI oculta la columna `host`. */
  supports_hosts: z.boolean(),
  database: z.string(),
  grantees: z.array(databaseGranteeSchema),
})
export type DatabaseGranteesOut = z.infer<typeof databaseGranteesOutSchema>
