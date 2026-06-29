import { z } from 'zod'
import { provisionStatusSchema } from './common'

/**
 * Reconciliación / drift (Plan 09 §2): cruza el plano en vivo (motor real) con el inventario
 * del gateway y devuelve, por cada BD y usuario, su estado. Es de solo lectura: no muta nada.
 */

/**
 * Estado de reconciliación de un objeto:
 * - `managed`: existe en el motor **y** en el inventario.
 * - `unmanaged`: solo en el motor → **adoptable**.
 * - `orphan`: solo en el inventario → se borró por fuera del gateway.
 */
export const reconcileStateSchema = z.enum(['managed', 'unmanaged', 'orphan'])
export type ReconcileState = z.infer<typeof reconcileStateSchema>

/** Una BD del servidor con su estado de reconciliación (§2). */
export const reconcileDatabaseItemSchema = z.object({
  name: z.string(),
  state: reconcileStateSchema,
  managed_id: z.number().int().nullable().optional(),
  owner_id: z.number().int().nullable().optional(),
  status: provisionStatusSchema.nullable().optional(),
})
export type ReconcileDatabaseItem = z.infer<typeof reconcileDatabaseItemSchema>

/** Un usuario del servidor con su estado de reconciliación (§2). */
export const reconcileUserItemSchema = z.object({
  username: z.string(),
  host: z.string().nullable().optional(),
  state: reconcileStateSchema,
  managed_id: z.number().int().nullable().optional(),
})
export type ReconcileUserItem = z.infer<typeof reconcileUserItemSchema>

/** `ReconcileResult` — foto combinada del servidor (§2). */
export const reconcileResultSchema = z.object({
  server_id: z.number().int(),
  databases: z.array(reconcileDatabaseItemSchema),
  users: z.array(reconcileUserItemSchema),
})
export type ReconcileResult = z.infer<typeof reconcileResultSchema>
