import { z } from 'zod'
import { HOST_PATTERN, IDENTIFIER_PATTERN } from './common'

/** `ServerUserOut` (§7). El password se cifra y nunca se devuelve. */
export const serverUserOutSchema = z.object({
  id: z.number().int(),
  server_id: z.number().int(),
  username: z.string(),
  host: z.string().nullable().optional(),
  is_active: z.boolean(),
  notes: z.string().nullable().optional(),
  has_password: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ServerUserOut = z.infer<typeof serverUserOutSchema>

/**
 * `ServerUserCreate` (§7). `password` es condicional: obligatorio si `?provision=true`
 * (esa regla se aplica en el formulario, no aquí, porque depende del flag de la request).
 */
export const serverUserCreateSchema = z.object({
  server_id: z.number().int().min(1),
  username: z
    .string()
    .min(1, 'Requerido')
    .regex(IDENTIFIER_PATTERN, 'Letra/_ inicial, hasta 63 caracteres alfanuméricos o _'),
  host: z
    .string()
    .regex(HOST_PATTERN, 'Host inválido (solo MySQL/MariaDB; `%` = wildcard)')
    .optional(),
  password: z.string().min(1).nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
})
export type ServerUserCreate = z.infer<typeof serverUserCreateSchema>

/** `ServerUserUpdate` (§7). `username`/`host`/`server_id` son inmutables. */
export const serverUserUpdateSchema = z.object({
  password: z.string().min(1).nullable().optional(),
  is_active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
})
export type ServerUserUpdate = z.infer<typeof serverUserUpdateSchema>
