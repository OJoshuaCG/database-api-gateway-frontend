import { z } from 'zod'
import {
  cloneCharsetSpecSchema,
  cloneCopyIntentSchema,
  cloneDataOnExistingSchema,
  cloneDataSpecSchema,
  cloneStructureSpecSchema,
  cloneTargetModeSchema,
} from './database-clones'

/**
 * Lotes de clonación (`database-clone-batches`): copiar N bases de un servidor a otro en un
 * solo gesto. Es la capa de ORQUESTACIÓN del clonado, no otro módulo: cada fila del lote
 * termina siendo un `CloneJob` real, con su pantalla de detalle de siempre.
 *
 * Tres cosas del contrato que la UI tiene que respetar y no puede deducir sola:
 *
 * 1. **El lote no borra el destino.** No hay `clean_mode` en ninguna parte de este contrato, y
 *    no es un olvido: un modo destructivo multiplicado por N y autorizado con un solo gesto es
 *    justo lo que tiene que seguir siendo de a una. La consecuencia visible es que sobre un
 *    destino EXISTENTE la única intención admitida es `data_only`.
 * 2. **No hay `preview`.** El plan de cada base se resuelve cuando le toca el turno, así que no
 *    existe un momento intermedio donde previsualizar. Lo que se confirma es el CONJUNTO de
 *    pares origen→destino, que es lo que ata `confirm_token`.
 * 3. **Las filas no ejecutables no rebotan el plan**: se crean con `status: 'blocked'` y su
 *    `error_code`. La UI las muestra todas juntas en vez de pedir una corrección por vez.
 */

// ── Estados ────────────────────────────────────────────────────────────────────
export const cloneBatchStatusSchema = z.enum([
  'pending',
  'running',
  'done',
  'partial',
  'failed',
  'interrupted',
  'canceled',
])
export type CloneBatchStatus = z.infer<typeof cloneBatchStatusSchema>

/** Estados terminales: el polling se detiene al alcanzar cualquiera. */
export const CLONE_BATCH_TERMINAL_STATUSES: ReadonlySet<CloneBatchStatus> = new Set([
  'done',
  'partial',
  'failed',
  'interrupted',
  'canceled',
])

/**
 * Estado EFECTIVO de una fila. Es la unión de dos vocabularios porque el backend resuelve
 * `COALESCE(job.status, item.outcome)`: mientras la fila no tiene job manda el suyo
 * (`pending`/`blocked`/`skipped`/`canceled`), y en cuanto lo tiene manda el del job.
 */
export const cloneBatchItemStatusSchema = z.enum([
  'pending',
  'blocked',
  'skipped',
  'running',
  'succeeded',
  'failed',
  'interrupted',
  'canceled',
])
export type CloneBatchItemStatus = z.infer<typeof cloneBatchItemStatusSchema>

// ── Entrada ────────────────────────────────────────────────────────────────────
export const cloneBatchRowInSchema = z.object({
  source_database_name: z.string().min(1).max(64),
  source_database_id: z.number().int().min(1).nullish(),
  /** Si falta, el backend usa el mismo nombre del origen. */
  target_database_name: z.string().min(1).max(64).nullish(),
  target_mode: cloneTargetModeSchema,
  /** Lo que esta fila le pisa al perfil global. Null = usa el perfil tal cual. */
  overrides: z.record(z.string(), z.unknown()).nullish(),
})
export type CloneBatchRowIn = z.infer<typeof cloneBatchRowInSchema>

export const cloneBatchCreateInSchema = z.object({
  source_server_id: z.number().int().min(1),
  target_server_id: z.number().int().min(1),
  copy_intent: cloneCopyIntentSchema,
  /** OBLIGATORIO con `copy_intent: 'data_only'`. No existe 'truncate': el lote no vacía tablas. */
  data_on_existing: cloneDataOnExistingSchema.nullish(),
  structure: cloneStructureSpecSchema.nullish(),
  data: cloneDataSpecSchema.nullish(),
  target_charset: cloneCharsetSpecSchema.nullish(),
  rows: z.array(cloneBatchRowInSchema).min(1),
})
export type CloneBatchCreateIn = z.infer<typeof cloneBatchCreateInSchema>

export const cloneBatchExecuteInSchema = z.object({
  /** Debe coincidir EXACTO con el nombre del servidor destino. Es el único re-tipeo del lote. */
  confirm_server_name: z.string().min(1, 'Requerido'),
  confirm_token: z.string().min(1, 'Requerido'),
})
export type CloneBatchExecuteIn = z.infer<typeof cloneBatchExecuteInSchema>

// ── Salida ─────────────────────────────────────────────────────────────────────
export const cloneBatchOutSchema = z.object({
  id: z.number().int(),
  source_server_id: z.number().int(),
  target_server_id: z.number().int(),
  copy_intent: cloneCopyIntentSchema,
  data_on_existing: cloneDataOnExistingSchema.nullish(),
  target_charset: z.string().nullish(),
  target_collation: z.string().nullish(),
  total: z.number().int(),
  confirm_token: z.string(),
  status: cloneBatchStatusSchema,
  cancel_requested: z.boolean(),
  error: z.string().nullish(),
  /**
   * Filas por estado efectivo, más `total`. Es la respuesta a «¿4 de 12?» y viene derivado en
   * vivo del estado de los hijos: se renderiza tal cual, sin re-sumarlo en el cliente.
   */
  counts: z.record(z.string(), z.number().int()),
  created_by_username: z.string().nullish(),
  created_at: z.string(),
  expires_at: z.string(),
  started_at: z.string().nullish(),
  finished_at: z.string().nullish(),
})
export type CloneBatchOut = z.infer<typeof cloneBatchOutSchema>

export const cloneBatchItemOutSchema = z.object({
  id: z.number().int(),
  batch_id: z.number().int(),
  seq: z.number().int(),
  source_database_name: z.string(),
  source_database_id: z.number().int().nullish(),
  target_database_name: z.string(),
  target_mode: cloneTargetModeSchema,
  /** Null = la fila todavía no se materializó en un job. */
  clone_job_id: z.number().int().nullish(),
  status: cloneBatchItemStatusSchema.nullish(),
  phase: z.string().nullish(),
  progress: z.object({ phase: z.string(), tables: z.record(z.string(), z.number().int()) }).nullish(),
  error: z.string().nullish(),
  /** Código estable del motivo, para mapearlo a nuestro texto en vez de parsear la prosa. */
  error_code: z.string().nullish(),
  /** Solo en `needs_manual`: por qué esta fila no se puede reintentar sola. */
  reason: z.string().nullish(),
  /**
   * Relojes de la FILA: arranca antes de `create_plan` y cierra después del job. Restarlos da
   * la base completa, preparación incluida.
   */
  started_at: z.string().nullish(),
  finished_at: z.string().nullish(),
  /**
   * Relojes del JOB: de cuando el worker lo reclama a cuando cierra. La diferencia contra
   * `started_at` es la preparación —el snapshot del origen de `create_plan`, el de `preview` y
   * una consulta de estadísticas por tabla—, que no emite ningún paso y por eso aparecía como
   * un bloque «sin atribuir» de ~25 s por base que parecía tiempo de cola y no lo era.
   *
   * `.nullish()` porque una fila que todavía no se materializó en job no los tiene, y porque
   * un backend anterior no los manda.
   */
  job_started_at: z.string().nullish(),
  job_finished_at: z.string().nullish(),
})
export type CloneBatchItemOut = z.infer<typeof cloneBatchItemOutSchema>

/**
 * Las filas no exitosas, partidas por si el destino quedó intacto.
 *
 * `needs_manual` son las que NO se pueden relanzar solas: o dejaron datos parciales (la copia
 * no es reanudable), o el intento anterior alcanzó a crear la base. El lote no puede limpiar
 * ninguno de los dos casos, así que se resuelven con el asistente de a una.
 */
export const cloneBatchRetryOutSchema = z.object({
  retryable: z.array(cloneBatchItemOutSchema),
  needs_manual: z.array(cloneBatchItemOutSchema),
})
export type CloneBatchRetryOut = z.infer<typeof cloneBatchRetryOutSchema>
