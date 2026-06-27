import { z } from 'zod'
import { engineTypeSchema, grantLevelSchema } from './common'
import { serverUserCreateSchema, serverUserOutSchema } from './server-users'

/**
 * Tipos de grants (§4) usados por servidores (`grantable`, §6) y usuarios del motor
 * (`grants`, `apply-profile`, `provision`, §7). Operan contra el motor destino 🔌.
 */

/** Rutina destino de un grant a nivel `routine` (§4). */
export const routineRefSchema = z.object({
  kind: z.enum(['FUNCTION', 'PROCEDURE']),
  name: z.string(),
})
export type RoutineRef = z.infer<typeof routineRefSchema>

/** `ObjectRef` — objeto destino de un grant; los campos dependen del nivel (§4). */
export const objectRefSchema = z.object({
  database: z.string().optional(),
  /** Solo PostgreSQL; default `"public"`. */
  schema: z.string().optional(),
  table: z.string().optional(),
  columns: z.array(z.string()).optional(),
  /** Solo PostgreSQL. */
  sequence: z.string().optional(),
  routine: routineRefSchema.optional(),
})
export type ObjectRef = z.infer<typeof objectRefSchema>

/** `GrantInfo` — privilegio efectivo (respuesta de introspección, §7). */
export const grantInfoSchema = z.object({
  level: grantLevelSchema,
  object: z.string().nullable().optional(),
  privileges: z.array(z.string()),
  with_grant_option: z.boolean(),
})
export type GrantInfo = z.infer<typeof grantInfoSchema>

/** `GrantRequest` — otorgar privilegios (§7). También sirve como `initial_grants`. */
export const grantRequestSchema = z.object({
  level: grantLevelSchema,
  object_ref: objectRefSchema,
  privileges: z.array(z.string()).min(1, 'Selecciona al menos un privilegio'),
  with_grant_option: z.boolean().optional(),
})
export type GrantRequest = z.infer<typeof grantRequestSchema>

/** Respuesta de `POST .../grants` (§7). */
export const grantResultSchema = z.object({
  granted: z.boolean(),
  level: grantLevelSchema,
  privileges: z.array(z.string()),
  with_grant_option: z.boolean(),
})
export type GrantResult = z.infer<typeof grantResultSchema>

/** `RevokeRequest` — cuerpo del `DELETE .../grants` (§7). `cascade` solo PostgreSQL. */
export const revokeRequestSchema = z.object({
  level: grantLevelSchema,
  object_ref: objectRefSchema,
  privileges: z.array(z.string()).min(1, 'Selecciona al menos un privilegio'),
  cascade: z.boolean().optional(),
})
export type RevokeRequest = z.infer<typeof revokeRequestSchema>

/** `GrantableRequest` — pre-chequeo de delegación `WITH GRANT OPTION` (§6). */
export const grantableRequestSchema = z.object({
  level: grantLevelSchema,
  object_ref: objectRefSchema,
  privileges: z.array(z.string()).min(1, 'Selecciona al menos un privilegio'),
})
export type GrantableRequest = z.infer<typeof grantableRequestSchema>

/** `GrantableResult` (§6). */
export const grantableResultSchema = z.object({
  can_grant: z.boolean(),
  level: grantLevelSchema,
  privileges: z.array(z.string()),
})
export type GrantableResult = z.infer<typeof grantableResultSchema>

/** Mapeo nivel → objeto para aplicar un perfil de permisos (§7). */
export const objectMappingSchema = z.object({
  level: grantLevelSchema,
  object_ref: objectRefSchema,
})
export type ObjectMapping = z.infer<typeof objectMappingSchema>

/** `ApplyProfileRequest` (§7). Un mapeo por cada nivel del perfil que quieras aplicar. */
export const applyProfileRequestSchema = z.object({
  object_mappings: z.array(objectMappingSchema),
})
export type ApplyProfileRequest = z.infer<typeof applyProfileRequestSchema>

/** `ApplyProfileResult` (§7). Best-effort: un grant que falle no aborta los demás. */
export const applyProfileResultSchema = z.object({
  profile_id: z.number().int(),
  profile_name: z.string(),
  engine: engineTypeSchema,
  grants_applied: z.number().int(),
  skipped_levels: z.array(z.string()),
  errors: z.array(z.string()),
})
export type ApplyProfileResult = z.infer<typeof applyProfileResultSchema>

/** `ServerUserFullCreate` — crea + aprovisiona + aplica `initial_grants` (§7). */
export const serverUserFullCreateSchema = serverUserCreateSchema.extend({
  initial_grants: z.array(grantRequestSchema).optional(),
})
export type ServerUserFullCreate = z.infer<typeof serverUserFullCreateSchema>

/** Resultado de cada grant inicial en `provision` (§7). */
export const grantApplicationResultSchema = z.object({
  level: grantLevelSchema,
  object: z.string().nullable().optional(),
  privileges: z.array(z.string()),
  success: z.boolean(),
  error: z.string().nullable().optional(),
})
export type GrantApplicationResult = z.infer<typeof grantApplicationResultSchema>

/** `ServerUserFullOut` — respuesta de `POST /server-users/provision` (§7). */
export const serverUserFullOutSchema = z.object({
  user: serverUserOutSchema,
  grants_applied: z.number().int(),
  grant_results: z.array(grantApplicationResultSchema),
})
export type ServerUserFullOut = z.infer<typeof serverUserFullOutSchema>
