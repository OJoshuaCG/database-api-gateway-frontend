import { z } from 'zod'

/**
 * Tipos y helpers compartidos del contrato de la API, derivados de
 * `backend/docs/api-reference.md` (§3, §4). Zod es la fuente de verdad: los tipos
 * TypeScript se infieren con `z.infer`, y los mismos schemas validan en runtime.
 */

// ── Enums (§4) ────────────────────────────────────────────────────────────────
export const engineTypeSchema = z.enum(['mysql', 'mariadb', 'postgresql'])
export type EngineType = z.infer<typeof engineTypeSchema>

export const serverStatusSchema = z.enum(['active', 'inactive', 'unreachable'])
export type ServerStatus = z.infer<typeof serverStatusSchema>

export const provisionStatusSchema = z.enum(['pending', 'active', 'error', 'archived'])
export type ProvisionStatus = z.infer<typeof provisionStatusSchema>

/** Desenlace de una migración en el historial (§4). */
export const migrationStatusSchema = z.enum(['applied', 'failed'])
export type MigrationStatus = z.infer<typeof migrationStatusSchema>

/**
 * Naturaleza de una versión/migración (Plan 09 §6, Plan 02): `schema` (DDL, portable salvo
 * procedurales) o `data` (datos-semilla de catálogo; siempre atada a `source_engine`, no se
 * traduce cross-engine).
 */
export const migrationKindSchema = z.enum(['schema', 'data'])
export type MigrationKind = z.infer<typeof migrationKindSchema>

/** Nivel de un grant (§4, §7, §11). `schema` y `sequence` solo PostgreSQL. */
export const grantLevelSchema = z.enum([
  'global',
  'database',
  'schema',
  'table',
  'column',
  'sequence',
  'routine',
])
export type GrantLevel = z.infer<typeof grantLevelSchema>

export const sslModeSchema = z.enum([
  'disable',
  'allow',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
])
export type SslMode = z.infer<typeof sslModeSchema>

// ── Patrones de identificadores (§4) ────────────────────────────────────────────
/** `username` (ServerUser) y `name` (ManagedDatabase): empieza por letra/`_`, ≤63. */
export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/
/** `host` (ServerUser): MySQL/MariaDB; `%` = wildcard. */
export const HOST_PATTERN = /^[A-Za-z0-9_.%:-]{1,255}$/
/** `slug` (DatabaseModel): kebab/snake en minúsculas. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/
/** `charset` / `collation`: MySQL/MariaDB. */
export const CHARSET_PATTERN = /^[A-Za-z0-9_]{1,64}$/
/** `version` (ModelMigration): solo dígitos, 4–10; se ordena NUMÉRICAMENTE (§8). */
export const MIGRATION_VERSION_PATTERN = /^\d{4,10}$/

// ── Paginación (§3) ──────────────────────────────────────────────────────────
export const paginationMetaSchema = z.object({
  page: z.number().int(),
  size: z.number().int(),
  total: z.number().int(),
  pages: z.number().int(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
})
export type PaginationMeta = z.infer<typeof paginationMetaSchema>

/**
 * Tamaño máximo de página que pedimos a la API en un único request (p. ej. al
 * poblar selects con "toda" la lista). Debe coincidir con el `size` máximo que
 * admite el backend (§3): si pedimos más, la API responde `422`.
 *
 * Se configura con `VITE_MAX_PAGE_SIZE` para mantenerlo sincronizado con el
 * backend desde un único punto, sin tocar código. Si la variable falta o es
 * inválida, se usa `50` como fallback seguro.
 */
function resolveMaxPageSize(): number {
  const parsed = Number(import.meta.env.VITE_MAX_PAGE_SIZE)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 50
}

/** Límites de paginación de la API (§3). `maxSize` ← `VITE_MAX_PAGE_SIZE`. */
export const PAGINATION = {
  defaultPage: 1,
  defaultSize: 20,
  maxSize: resolveMaxPageSize(),
} as const

// ── Envelope `ApiResponse[T]` (§3) ─────────────────────────────────────────────
/**
 * Respuesta exitosa con `data` (las claves `null` se omiten en el JSON del backend,
 * por eso `message`/`pagination` son opcionales).
 */
export function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    data,
    message: z.string().optional(),
    pagination: paginationMetaSchema.optional(),
  })
}

/** Envelope paginado: `data` es una lista y `pagination` está presente. */
export function paginatedEnvelope<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    message: z.string().optional(),
    pagination: paginationMetaSchema,
  })
}

/** Envelope sin contenido (DELETE / acciones void): `{}` o `{ message }`. */
export const emptyEnvelopeSchema = z.object({
  message: z.string().optional(),
})

/** Lista NO paginada (p. ej. `/privileges`): solo `{ data: [...] }`. */
export function listEnvelope<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    message: z.string().optional(),
  })
}

// ── Página genérica normalizada para la UI ──────────────────────────────────────
export interface Page<T> {
  items: T[]
  pagination: PaginationMeta
}
