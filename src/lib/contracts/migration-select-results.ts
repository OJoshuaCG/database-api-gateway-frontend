import { z } from 'zod'

/**
 * Captura de resultados de `SELECT` dentro de una migración (api-reference-v9 §3.5/§3.6/§7).
 * Módulo NUEVO: lee/purga las filas capturadas por una versión ya aplicada/revertida en una BD
 * puntual. No pagina — trae todo de la corrida más reciente de una sola vez.
 */

export const migrationCaptureDirectionSchema = z.enum(['up', 'down'])
export type MigrationCaptureDirection = z.infer<typeof migrationCaptureDirectionSchema>

export const migrationCaptureStatusSchema = z.enum(['ok', 'error'])
export type MigrationCaptureStatus = z.infer<typeof migrationCaptureStatusSchema>

/**
 * Persistencia real de la fila (§4.3): `committed` siempre en MySQL/MariaDB (autocommit).
 * En PostgreSQL, `rolled_back` si la migración falló y el motor deshizo la transacción — la fila
 * SÍ se guarda y es legible, pero describe datos de un intento que no llegó a persistir.
 */
export const migrationCaptureDurabilitySchema = z.enum(['committed', 'rolled_back', 'unknown'])
export type MigrationCaptureDurability = z.infer<typeof migrationCaptureDurabilitySchema>

/**
 * Resultado capturado de UN statement `SELECT`/`WITH`/`TABLE`/`VALUES` (§3.5, §7).
 *
 * ⚠️ `rows` es POSICIONAL, no una lista de objetos: `rows[i][j]` es la columna `columns[j]` de
 * la fila `i`. La UI tiene que mapear por índice, nunca asumir claves como `{"id": 101}`.
 */
export const migrationSelectResultItemSchema = z.object({
  statement_index: z.number().int(),
  direction: migrationCaptureDirectionSchema,
  sql: z.string(),
  sql_hash: z.string(),
  status: migrationCaptureStatusSchema,
  durability: migrationCaptureDurabilitySchema,
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  row_count: z.number().int().optional().default(0),
  truncated: z.boolean().optional().default(false),
  payload_bytes: z.number().int().optional().default(0),
  error: z.string().nullable().optional(),
  captured_at: z.string(),
  migration_checksum: z.string(),
})
export type MigrationSelectResultItem = z.infer<typeof migrationSelectResultItemSchema>

/**
 * Respuesta de `GET .../migrations/{version}/select-results` (§3.5). `items: []` es un estado
 * válido con `200`: distinguir por `capture_selects` si "nunca se capturó nada" (`false`) de "se
 * capturó y expiró/se purgó" (`true`) — nunca hay `404`/`410`/`409` por vencimiento (§4.6).
 */
export const migrationSelectResultsOutSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string(),
  server_id: z.number().int(),
  model_migration_id: z.number().int(),
  version: z.string(),
  capture_selects: z.boolean().optional().default(false),
  stale: z.boolean().optional().default(false),
  expected_indexes: z.array(z.number().int()).optional().default([]),
  missing_indexes: z.array(z.number().int()).optional().default([]),
  durability_warning: z.string().nullable().optional(),
  items: z.array(migrationSelectResultItemSchema).optional().default([]),
})
export type MigrationSelectResultsOut = z.infer<typeof migrationSelectResultsOutSchema>
