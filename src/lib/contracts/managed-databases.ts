import { z } from 'zod'
import { CHARSET_PATTERN, engineTypeSchema, IDENTIFIER_PATTERN, provisionStatusSchema } from './common'

/**
 * Origen de una BD gestionada (Plan 09): `provisioned` la creó el gateway, `adopted` ya existía
 * en el motor y se trajo al inventario sin recrearla. Útil para distinguirlas con un badge.
 */
export const databaseOriginSchema = z.enum(['provisioned', 'adopted'])
export type DatabaseOrigin = z.infer<typeof databaseOriginSchema>

/**
 * `ManagedDatabaseOut` (§9). Plan 09 añade `origin`. `engine` (feature `schema-comparisons`) es
 * opcional: si el backend no lo incluye, se resuelve por join con `ServerOut.engine` vía
 * `server_id` (mismo patrón que `ManagedDatabasesPage` ya usa para resolver el nombre del server).
 */
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
  origin: databaseOriginSchema.optional(),
  engine: engineTypeSchema.optional(),
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

/**
 * `AdoptDatabaseIn` (Plan 09 §3) — registra una BD **ya existente** en el motor sin recrearla.
 * El gateway verifica que exista (solo lectura); exige un `owner_id` (ServerUser del mismo
 * servidor). `model_id` opcional para vincular un blueprint en el mismo paso.
 *
 * `model_version` (Cambio 1) declara en qué versión del blueprint ya se encuentra la BD: el
 * gateway hace `stamp` de esa versión (sin ejecutar DDL) para que un `apply` posterior no
 * reintente crear objetos que ya existen. Requiere `model_id`; el backend valida que la versión
 * exista antes de registrar la BD (si no, `422` y la BD **no** queda registrada).
 */
export const adoptDatabaseInSchema = z
  .object({
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
  .refine((value) => value.model_version == null || value.model_id != null, {
    message: 'La versión de partida requiere elegir un blueprint.',
    path: ['model_version'],
  })
export type AdoptDatabaseIn = z.infer<typeof adoptDatabaseInSchema>
