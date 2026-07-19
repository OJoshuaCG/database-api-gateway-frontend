import { z } from 'zod'

/** `ColumnInfo` — columna de una tabla (§6). */
export const columnInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  default: z.string().nullable().optional(),
  primary_key: z.boolean(),
  autoincrement: z.boolean(),
  comment: z.string().nullable().optional(),
})
export type ColumnInfo = z.infer<typeof columnInfoSchema>

/** `ForeignKeyInfo` (§6). */
export const foreignKeyInfoSchema = z.object({
  name: z.string().nullable().optional(),
  columns: z.array(z.string()),
  referred_table: z.string(),
  referred_columns: z.array(z.string()),
})
export type ForeignKeyInfo = z.infer<typeof foreignKeyInfoSchema>

/** `IndexInfo` (§6). */
export const indexInfoSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean(),
})
export type IndexInfo = z.infer<typeof indexInfoSchema>

/** `TableSchema` — estructura de una tabla, nunca filas (§6). */
export const tableSchemaSchema = z.object({
  database: z.string(),
  table: z.string(),
  columns: z.array(columnInfoSchema),
  primary_key: z.array(z.string()),
  foreign_keys: z.array(foreignKeyInfoSchema),
  indexes: z.array(indexInfoSchema),
})
export type TableSchema = z.infer<typeof tableSchemaSchema>
