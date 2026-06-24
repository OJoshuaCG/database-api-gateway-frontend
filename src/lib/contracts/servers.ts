import { z } from 'zod'
import { engineTypeSchema, serverStatusSchema, sslModeSchema } from './common'

/** `ssl_mode` de salida: el backend puede devolver `null` o cadena vacía ⇒ sin TLS. */
const sslModeOutputSchema = z.union([sslModeSchema, z.literal('')]).nullable()

/** `ServerOut` (§6). La credencial pseudo-root nunca se devuelve. */
export const serverOutSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  engine: engineTypeSchema,
  root_username: z.string(),
  ssl_mode: sslModeOutputSchema.optional(),
  status: serverStatusSchema,
  is_active: z.boolean(),
  notes: z.string().nullable().optional(),
  has_root_password: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ServerOut = z.infer<typeof serverOutSchema>

/** `ServerCreate` (§6). */
export const serverCreateSchema = z.object({
  name: z.string().min(1, 'Requerido').max(100, 'Máximo 100 caracteres'),
  host: z.string().min(1, 'Requerido').max(255, 'Máximo 255 caracteres'),
  port: z.number().int().min(1, 'Puerto 1–65535').max(65535, 'Puerto 1–65535'),
  engine: engineTypeSchema,
  root_username: z.string().min(1, 'Requerido').max(128, 'Máximo 128 caracteres'),
  root_password: z.string().min(1, 'Requerido'),
  ssl_mode: sslModeSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
})
export type ServerCreate = z.infer<typeof serverCreateSchema>

/** `ServerUpdate` — todos los campos opcionales; `root_password` omitido ⇒ no cambia. */
export const serverUpdateSchema = serverCreateSchema.partial()
export type ServerUpdate = z.infer<typeof serverUpdateSchema>

/** `ConnectionInfo` — resultado de `test-connection` 🔌 (§6). */
export const connectionInfoSchema = z.object({
  ok: z.boolean(),
  dialect: z.string(),
  server_version: z.string().nullable().optional(),
})
export type ConnectionInfo = z.infer<typeof connectionInfoSchema>
