import { z } from 'zod'
import { engineTypeSchema } from './common'

/** `PrivilegeOut` (§10). */
export const privilegeOutSchema = z.object({
  id: z.number().int(),
  engine: engineTypeSchema,
  name: z.string(),
  category: z.string(),
  context: z.string().nullable().optional(),
  description: z.string(),
  is_sensitive: z.boolean(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type PrivilegeOut = z.infer<typeof privilegeOutSchema>

/** `PrivilegeUpdate` (§10). */
export const privilegeUpdateSchema = z.object({
  is_active: z.boolean(),
})
export type PrivilegeUpdate = z.infer<typeof privilegeUpdateSchema>
