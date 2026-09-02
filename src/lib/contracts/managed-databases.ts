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
  /**
   * Solo en el alta con `apply_migrations`. Ausente = no se pidió migrar. `ok: false` significa
   * que la BD SÍ se creó y la migración falló: la fila queda en cuarentena y `error_code` dice
   * a qué endpoint volver. Por eso el alta responde 201 igual — hay una base real creada.
   */
  migration: z
    .object({
      ok: z.boolean(),
      from_version: z.string().nullable().optional(),
      to_version: z.string().nullable().optional(),
      applied: z.array(z.string()).optional(),
      error: z.string().nullable().optional(),
      error_code: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  /**
   * Entorno que clasifica esta BD; `null` = sin clasificar (y por lo tanto SIN la protección
   * del guard de migraciones destructivas). Llega como id crudo: el nombre y el color se
   * resuelven con un join en cliente contra el catálogo (`useEnvironmentMap`).
   *
   * Este campo lo heredan `modelDatabaseStatusSchema` (vía `.extend()`) y `listOwnedDatabases`,
   * así que un solo agregado cubre los tres endpoints que comparten este schema.
   */
  environment_id: z.number().int().nullable().optional(),
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

/**
 * `ManagedDatabaseProvisionOut` — respuesta de `POST /managed-databases/{id}/provision` 🔌.
 *
 * Ejecuta el `CREATE DATABASE` que faltaba sobre una fila YA registrada (estado `pending`, o
 * `error` si el DDL del alta falló). No aplica migraciones del blueprint ni otorga privilegios.
 *
 * `provisioned: false` no es un fallo: significa que otra llamada simultánea al mismo endpoint
 * creó la base primero y esta solo reconcilió el estado del inventario.
 */
export const managedDatabaseProvisionOutSchema = z.object({
  database: managedDatabaseOutSchema,
  provisioned: z.boolean(),
  previous_status: provisionStatusSchema,
  charset: z.string().nullish(),
  collation: z.string().nullish(),
})
export type ManagedDatabaseProvisionOut = z.infer<typeof managedDatabaseProvisionOutSchema>

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
  /**
   * `model_version` ya NO va en el alta: el backend la rechaza con 422
   * (`managed_database.model_version_not_writable`). Se escribía en el inventario sin tocar el
   * motor, así que la base quedaba vacía declarando estar migrada — y esa caché es la que
   * decide si una versión del blueprint es borrable, de modo que declararla la congelaba como
   * «en uso» sin que ninguna base la tuviera aplicada.
   *
   * Para crear la base ya migrada están los dos campos de abajo; para registrar una que YA
   * está físicamente en esa versión sigue estando `adopt`, donde `model_version` sí dispara un
   * `stamp` real y por eso ahí se conserva.
   */
  apply_migrations: z.boolean().optional(),
  /** Versión objetivo inclusive. Omitirla aplica hasta la última. */
  target_version: z
    .string()
    .regex(/^\d{4,10}$/, 'Cuatro a diez dígitos, como 0007')
    .nullable()
    .optional(),
  /** Requerido en el alta a propósito: ver el comentario de `ManagedDatabaseUpdate`. */
  environment_id: z.number().int().min(1, 'Selecciona un entorno'),
  charset: charsetField,
  collation: charsetField,
  notes: z.string().nullable().optional(),
})
export type ManagedDatabaseCreate = z.infer<typeof managedDatabaseCreateSchema>

/**
 * `ManagedDatabaseUpdate` — `name`/`server_id`/`owner_id` no se editan aquí.
 *
 * `model_version` TAMPOCO, y no es un olvido: el backend dejó de aceptarlo y lo **descarta en
 * silencio**, así que dejarlo acá hacía que la UI mintiera (el operador escribe, guarda, ve el
 * toast de éxito y el valor no cambió). Se sigue aceptando en `create` y en `adopt`, donde el
 * backend sí lo valida contra el blueprint. Para declararla a mano está
 * `POST /{id}/migrations/stamp`.
 *
 * `environment_id` es la vía de RECLASIFICACIÓN, y `null` DESCLASIFICA — lo que además le quita
 * a la base la protección del guard. Por eso el body de este PATCH se construye por PRESENCIA
 * de la clave (`dirtyFields`) y no por valor: ver `toManagedDatabaseUpdate`.
 */
export const managedDatabaseUpdateSchema = z.object({
  model_id: z.number().int().min(1).nullable().optional(),
  environment_id: z.number().int().min(1).nullable().optional(),
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
    /** Entorno del destino adoptado. Si se omite, el backend usa el marcado `is_default`. */
    environment_id: z.number().int().min(1).nullable().optional(),
    charset: charsetField,
    collation: charsetField,
    notes: z.string().nullable().optional(),
  })
  .refine((value) => value.model_version == null || value.model_id != null, {
    message: 'La versión de partida requiere elegir un blueprint.',
    path: ['model_version'],
  })
export type AdoptDatabaseIn = z.infer<typeof adoptDatabaseInSchema>
