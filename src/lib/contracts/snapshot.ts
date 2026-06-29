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

/** Una sentencia DDL del snapshot (§5). */
export const dumpStatementSchema = z.object({
  object_type: dumpObjectTypeSchema,
  name: z.string(),
  ddl: z.string(),
})
export type DumpStatement = z.infer<typeof dumpStatementSchema>

/** `StructureDump` — estructura completa de una BD (§5). */
export const structureDumpSchema = z.object({
  database: z.string(),
  source_engine: engineTypeSchema,
  has_non_portable: z.boolean(),
  statements: z.array(dumpStatementSchema),
})
export type StructureDump = z.infer<typeof structureDumpSchema>
