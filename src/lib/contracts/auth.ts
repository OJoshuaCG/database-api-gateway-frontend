import { z } from 'zod'

/** `AdminOut` — administrador autenticado (§5). */
export const adminOutSchema = z.object({
  id: z.number().int(),
  username: z.string(),
})
export type AdminOut = z.infer<typeof adminOutSchema>

/** `LoginIn` — credenciales de login (§5). */
export const loginInSchema = z.object({
  username: z.string().min(1, 'Requerido').max(128, 'Máximo 128 caracteres'),
  password: z.string().min(1, 'Requerido'),
})
export type LoginIn = z.infer<typeof loginInSchema>
