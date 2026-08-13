import { z } from 'zod'

/**
 * Catálogo global de combinaciones charset/collation habilitadas para crear bases de datos
 * (`GET/POST/PATCH /charset-collation-options`). El backend valida la forma de `charset` y
 * `collation` (422 con el patrón en `public_context.pattern`); no se duplica esa validación
 * aquí para no divergir si el backend la ajusta.
 */

/** Familia de motor del catálogo: MySQL y MariaDB comparten la misma familia (`mysql`). */
export const engineFamilySchema = z.enum(['mysql', 'postgresql'])
export type EngineFamily = z.infer<typeof engineFamilySchema>

/** `CharsetCollationOptionOut`. */
export const charsetCollationOptionOutSchema = z.object({
  id: z.number().int(),
  engine_family: engineFamilySchema,
  charset: z.string(),
  collation: z.string().nullable(),
  enabled: z.boolean(),
  is_default: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type CharsetCollationOptionOut = z.infer<typeof charsetCollationOptionOutSchema>

/** `CharsetCollationOptionCreate`. */
export const charsetCollationOptionCreateSchema = z.object({
  engine_family: engineFamilySchema,
  charset: z.string().min(1).max(64),
  collation: z.string().max(128).nullable().optional(),
  enabled: z.boolean().optional(),
})
export type CharsetCollationOptionCreate = z.infer<typeof charsetCollationOptionCreateSchema>

/** `CharsetCollationOptionUpdate`. */
export const charsetCollationOptionUpdateSchema = z.object({
  enabled: z.boolean().nullable().optional(),
  is_default: z.boolean().nullable().optional(),
})
export type CharsetCollationOptionUpdate = z.infer<typeof charsetCollationOptionUpdateSchema>
