import { z } from 'zod'
import { engineTypeSchema, SLUG_PATTERN } from './common'

/** `DatabaseModelOut` (§8). */
export const databaseModelOutSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  current_version: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type DatabaseModelOut = z.infer<typeof databaseModelOutSchema>

/** `DatabaseModelCreate` (§8). */
export const databaseModelCreateSchema = z.object({
  name: z.string().min(1, 'Requerido').max(100, 'Máximo 100 caracteres'),
  slug: z
    .string()
    .min(1, 'Requerido')
    .max(120, 'Máximo 120 caracteres')
    .regex(SLUG_PATTERN, 'kebab/snake en minúsculas (ej. mi-blueprint)'),
  description: z.string().nullable().optional(),
  current_version: z.string().max(50, 'Máximo 50 caracteres').optional(),
  is_active: z.boolean().optional(),
})
export type DatabaseModelCreate = z.infer<typeof databaseModelCreateSchema>

/** `DatabaseModelUpdate` — mismos campos, todos opcionales. */
export const databaseModelUpdateSchema = databaseModelCreateSchema.partial()
export type DatabaseModelUpdate = z.infer<typeof databaseModelUpdateSchema>

/**
 * `FromSnapshotIn` (Plan 09 §6) — crea un blueprint cuyo baseline `0001` es el snapshot
 * estructural de una BD existente. El baseline nace `reviewed=false`.
 */
export const fromSnapshotInSchema = z.object({
  server_id: z.number().int().min(1),
  database: z.string().min(1, 'Requerido'),
  name: z.string().min(1, 'Requerido').max(100, 'Máximo 100 caracteres'),
  slug: z
    .string()
    .min(1, 'Requerido')
    .max(120, 'Máximo 120 caracteres')
    .regex(SLUG_PATTERN, 'kebab/snake en minúsculas (ej. crm-legacy)'),
  description: z.string().nullable().optional(),
  baseline_name: z.string().max(200).nullable().optional(),
})
export type FromSnapshotIn = z.infer<typeof fromSnapshotInSchema>

/** `FromSnapshotOut` (Plan 09 §6) — blueprint creado + resumen del snapshot. */
export const fromSnapshotOutSchema = z.object({
  model: databaseModelOutSchema,
  baseline_version: z.string(),
  source_engine: engineTypeSchema,
  has_non_portable: z.boolean(),
  object_counts: z.record(z.string(), z.number()),
  statements_captured: z.number().int(),
})
export type FromSnapshotOut = z.infer<typeof fromSnapshotOutSchema>
