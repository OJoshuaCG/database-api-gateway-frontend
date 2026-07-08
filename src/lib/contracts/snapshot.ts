import { z } from 'zod'
import { engineTypeSchema } from './common'

/**
 * Snapshot estructural (Plan 09 §5): introspección en vivo de una BD que devuelve las sentencias
 * DDL para reconstruir su estructura, en orden de dependencia. **Solo estructura, jamás filas.**
 */

/** Tipo de objeto de una sentencia del snapshot. Los procedurales atan el blueprint a su motor. */
export const dumpObjectTypeSchema = z.enum([
  'table',
  'view',
  'materialized_view',
  'routine',
  'trigger',
  'sequence',
  'type',
  'extension',
  'index',
  'event',
])
export type DumpObjectType = z.infer<typeof dumpObjectTypeSchema>

/** Tipos procedurales: su presencia hace el snapshot no portable entre motores. */
export const NON_PORTABLE_OBJECT_TYPES: ReadonlySet<DumpObjectType> = new Set([
  'routine',
  'trigger',
  'event',
])

/**
 * Una sentencia DDL del snapshot (§5). `depends_on` lista los nombres de tablas de las que
 * depende el objeto (FK / trigger→tabla / índice→tabla); se usa para validar el orden de las
 * versiones en el layout manual. Backends antiguos podían omitirlo → default `[]`.
 */
export const dumpStatementSchema = z.object({
  object_type: dumpObjectTypeSchema,
  name: z.string(),
  ddl: z.string(),
  depends_on: z.array(z.string()).default([]),
})
export type DumpStatement = z.infer<typeof dumpStatementSchema>

/**
 * `TableStat` — estimación por tabla para decidir qué catálogos sembrar (Plan 09 §5, opt-in con
 * `include_data_stats=true`). `estimated_rows` es una ESTIMACIÓN del catálogo del motor, no un
 * conteo exacto. Si `has_primary_key=false` la tabla NO puede sembrar datos (upsert requiere PK).
 */
export const tableStatSchema = z.object({
  table: z.string(),
  estimated_rows: z.number(),
  has_primary_key: z.boolean(),
})
export type TableStat = z.infer<typeof tableStatSchema>

/**
 * `StructureDump` — estructura completa de una BD (§5). `object_counts` es un mapa
 * `{ object_type: n }` derivado por el backend (opcional: si falta, se deriva en cliente de
 * `statements`). `table_stats` solo llega con `include_data_stats=true`; en caso contrario es
 * `null`.
 */
export const structureDumpSchema = z.object({
  database: z.string(),
  source_engine: engineTypeSchema,
  has_non_portable: z.boolean(),
  statements: z.array(dumpStatementSchema),
  object_counts: z.record(z.string(), z.number()).optional(),
  table_stats: z.array(tableStatSchema).nullable().optional(),
})
export type StructureDump = z.infer<typeof structureDumpSchema>
