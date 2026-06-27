import { z } from 'zod'
import { engineTypeSchema, grantLevelSchema } from './common'

/**
 * Perfiles de permisos (§11): plantillas de privilegios por motor, reutilizables vía
 * `apply-profile` (§7). CRUD puro de inventario; no toca ningún motor.
 */

/** Item de entrada de un perfil. */
export const permissionProfileItemInSchema = z.object({
  level: grantLevelSchema,
  privileges: z.array(z.string()).min(1, 'Selecciona al menos un privilegio'),
})
export type PermissionProfileItemIn = z.infer<typeof permissionProfileItemInSchema>

/** Item de salida de un perfil (añade `requires_confirmation`). */
export const permissionProfileItemOutSchema = z.object({
  level: grantLevelSchema,
  privileges: z.array(z.string()),
  requires_confirmation: z.boolean(),
})
export type PermissionProfileItemOut = z.infer<typeof permissionProfileItemOutSchema>

/** `PermissionProfileOut` (§11). */
export const permissionProfileOutSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  engine: engineTypeSchema,
  description: z.string().nullable().optional(),
  is_active: z.boolean(),
  items: z.array(permissionProfileItemOutSchema),
  created_at: z.string(),
  updated_at: z.string(),
})
export type PermissionProfileOut = z.infer<typeof permissionProfileOutSchema>

/** `PermissionProfileCreate` (§11). */
export const permissionProfileCreateSchema = z.object({
  name: z.string().min(1, 'Requerido').max(100, 'Máximo 100 caracteres'),
  engine: engineTypeSchema,
  description: z.string().max(255, 'Máximo 255 caracteres').nullable().optional(),
  items: z.array(permissionProfileItemInSchema).min(1, 'Añade al menos un item'),
})
export type PermissionProfileCreate = z.infer<typeof permissionProfileCreateSchema>

/**
 * `PermissionProfileUpdate` (§11). `engine` es inmutable; si envías `items`, reemplazan
 * por completo los anteriores.
 */
export const permissionProfileUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(255).nullable().optional(),
  is_active: z.boolean().optional(),
  items: z.array(permissionProfileItemInSchema).min(1).optional(),
})
export type PermissionProfileUpdate = z.infer<typeof permissionProfileUpdateSchema>
