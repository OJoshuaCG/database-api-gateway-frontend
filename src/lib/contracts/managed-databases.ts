import { z } from 'zod'
import { CHARSET_PATTERN, IDENTIFIER_PATTERN, provisionStatusSchema } from './common'

/** `ManagedDatabaseOut` (§9). */
export const managedDatabaseOutSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  server_id: z.number().int(),
  owner_id: z.number().int(),
  model_id: z.number().int().nullable().optional(),
  model_version: z.string().nullable().optional(),
  charset: z.string().nullable().optional(),
  collation: z.string().nullable().optional(),
  status: provisionStatusSchema,
  notes: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ManagedDatabaseOut = z.infer<typeof managedDatabaseOutSchema>

const charsetField = z
  .string()
  .regex(CHARSET_PATTERN, 'Solo MySQL/MariaDB; [A-Za-z0-9_], 1–64')
  .nullable()
  .optional()

/** `ManagedDatabaseCreate` (§9). `owner_id` debe ser un ServerUser del mismo server. */
export const managedDatabaseCreateSchema = z.object({
  name: z
    .string()
    .min(1, 'Requerido')
    .regex(IDENTIFIER_PATTERN, 'Letra/_ inicial, hasta 63 caracteres alfanuméricos o _'),
  server_id: z.number().int().min(1),
  owner_id: z.number().int().min(1, 'Selecciona un propietario'),
  model_id: z.number().int().min(1).nullable().optional(),
  model_version: z.string().max(50, 'Máximo 50 caracteres').nullable().optional(),
  charset: charsetField,
  collation: charsetField,
  notes: z.string().nullable().optional(),
})
export type ManagedDatabaseCreate = z.infer<typeof managedDatabaseCreateSchema>

/** `ManagedDatabaseUpdate` — `name`/`server_id`/`owner_id` no se editan aquí. */
export const managedDatabaseUpdateSchema = z.object({
  model_id: z.number().int().min(1).nullable().optional(),
  model_version: z.string().max(50).nullable().optional(),
  charset: charsetField,
  collation: charsetField,
  notes: z.string().nullable().optional(),
})
export type ManagedDatabaseUpdate = z.infer<typeof managedDatabaseUpdateSchema>

/** `ReassignOwnerIn` — nuevo propietario (mismo servidor) (§9). */
export const reassignOwnerInSchema = z.object({
  owner_id: z.number().int().min(1, 'Selecciona un propietario'),
})
export type ReassignOwnerIn = z.infer<typeof reassignOwnerInSchema>
