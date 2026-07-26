import { z } from 'zod'
import { engineTypeSchema, HOST_PATTERN, IDENTIFIER_PATTERN } from './common'

/**
 * Usuarios del motor agrupados por identidad física (`server_id` + `username` + `host`) y su
 * CRUD asociado. Cruza el plano en vivo (motor) con el inventario (`server_users`) sin exigir
 * adopción previa — ver `docs/features/engine-users-management.md`.
 */

/**
 * Estado de una identidad frente al inventario:
 * - `adopted`: existe fila en `server_users` (gestionada por el gateway).
 * - `unmanaged`: solo en el motor (adoptable).
 * - `orphan`: solo en el inventario (borrada por fuera del gateway → drift).
 */
export const engineUserIdentityStatusSchema = z.enum(['adopted', 'unmanaged', 'orphan'])
export type EngineUserIdentityStatus = z.infer<typeof engineUserIdentityStatusSchema>

/** Una identidad (`user@host`, o el rol completo en PostgreSQL) dentro de un username agrupado. */
export const engineUserIdentitySchema = z.object({
  host: z.string().nullable().optional(),
  status: engineUserIdentityStatusSchema,
  /** Llave hacia `/server-users/{id}/grants`. Presente si `status !== 'unmanaged'`. */
  server_user_id: z.number().int().nullable().optional(),
  /** El gateway conoce la contraseña en claro (la fijó él mismo) → habilita "Revelar". */
  has_password: z.boolean(),
  is_active: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),
})
export type EngineUserIdentity = z.infer<typeof engineUserIdentitySchema>

/** Un username con todas sus identidades (hosts en MySQL/MariaDB; una sola en PostgreSQL). */
export const groupedEngineUserSchema = z.object({
  username: z.string(),
  identity_count: z.number().int(),
  identities: z.array(engineUserIdentitySchema),
})
export type GroupedEngineUser = z.infer<typeof groupedEngineUserSchema>

/**
 * `GroupedEngineUsersOut` — respuesta de `GET /servers/{id}/users/grouped`. `supports_hosts`
 * es la bandera maestra de la asimetría por motor: en `false` (PostgreSQL) cada usuario tiene
 * una sola identidad con `host: null` y la UI debe ocultar columna/acciones de host.
 */
export const groupedEngineUsersOutSchema = z.object({
  dialect: engineTypeSchema,
  supports_hosts: z.boolean(),
  users: z.array(groupedEngineUserSchema),
})
export type GroupedEngineUsersOut = z.infer<typeof groupedEngineUsersOutSchema>

// ── CRUD por identidad 🔌 ────────────────────────────────────────────────────

/** `EngineUserCreateIn` — `POST /servers/{id}/users` (`CREATE USER`). */
export const engineUserCreateInSchema = z.object({
  username: z
    .string()
    .min(1, 'Requerido')
    .regex(IDENTIFIER_PATTERN, 'Letra/_ inicial, hasta 63 caracteres alfanuméricos o _'),
  host: z.string().regex(HOST_PATTERN, 'Host inválido').optional(),
  password: z.string().min(1, 'Requerido'),
  adopt: z.boolean().optional(),
  notes: z.string().nullable().optional(),
})
export type EngineUserCreateIn = z.infer<typeof engineUserCreateInSchema>

/** Salida común de create/cambio de contraseña: refleja si quedó adoptada tras la operación. */
export const engineUserMutationOutSchema = z.object({
  username: z.string(),
  host: z.string().nullable().optional(),
  adopted: z.boolean(),
  server_user_id: z.number().int().nullable().optional(),
})
export type EngineUserMutationOut = z.infer<typeof engineUserMutationOutSchema>

/** `EnginePasswordChangeIn` — `PATCH /servers/{id}/users/password` (`ALTER USER/ROLE`). */
export const enginePasswordChangeInSchema = z.object({
  username: z.string().min(1, 'Requerido'),
  host: z.string().regex(HOST_PATTERN, 'Host inválido').optional(),
  new_password: z.string().min(1, 'Requerido'),
  /** Solo aplica si NO existe fila de inventario previa. */
  adopt: z.boolean().optional(),
})
export type EnginePasswordChangeIn = z.infer<typeof enginePasswordChangeInSchema>

/**
 * `AddHostIn` — `POST /servers/{id}/users/add-host` (solo MySQL/MariaDB). Clona una cuenta
 * existente a un nuevo host. `new_password` es obligatorio solo si `reuse_password=false`.
 */
export const addHostInSchema = z
  .object({
    username: z.string().min(1, 'Requerido'),
    source_host: z.string().regex(HOST_PATTERN, 'Host inválido').optional(),
    new_host: z.string().min(1, 'Requerido').regex(HOST_PATTERN, 'Host inválido (`%` = wildcard)'),
    reuse_password: z.boolean().optional(),
    new_password: z.string().min(1).nullable().optional(),
    copy_grants: z.boolean().optional(),
    adopt: z.boolean().optional(),
    notes: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reuse_password === false && !value.new_password?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['new_password'],
        message: 'Requerido si no se reutiliza la contraseña.',
      })
    }
  })
export type AddHostIn = z.infer<typeof addHostInSchema>

export const addHostOutSchema = z.object({
  username: z.string(),
  new_host: z.string(),
  password_mode: z.enum(['reused', 'new']),
  grants_copied: z.number().int(),
  /** Presente si `copy_grants=true` falló parcialmente (best-effort; el host sí se creó). */
  grants_error: z.string().nullable().optional(),
  adopted: z.boolean(),
  server_user_id: z.number().int().nullable().optional(),
})
export type AddHostOut = z.infer<typeof addHostOutSchema>

// ── Operaciones batch por username (todos los hosts) 🔌 (§7.4) ──────────────
// Fail-tolerant por host: responden 200/201 y el desenlace REAL de cada identidad vive en
// `results[]`, no en el código HTTP. En PostgreSQL `results[].host` es `null` (rol sin host).

/**
 * `AdoptAllHostsIn` — `POST /servers/{id}/users/adopt-all-hosts`. Adopta TODAS las identidades
 * en vivo de un username de una sola llamada; nunca ejecuta `CREATE USER`.
 */
export const adoptAllHostsInSchema = z.object({
  username: z.string().min(1, 'Requerido'),
  /** Si se envía, se cifra y guarda en TODAS las filas SIN ejecutar `ALTER USER` (no se verifica). */
  known_password: z.string().min(1).nullable().optional(),
  notes: z.string().nullable().optional(),
})
export type AdoptAllHostsIn = z.infer<typeof adoptAllHostsInSchema>

/** `already_adopted` NO es error: un mix de ambos estados es un éxito normal. */
export const batchAdoptStatusSchema = z.enum(['adopted', 'already_adopted'])
export type BatchAdoptStatus = z.infer<typeof batchAdoptStatusSchema>

export const batchAdoptResultSchema = z.object({
  host: z.string().nullable().optional(),
  status: batchAdoptStatusSchema,
  server_user_id: z.number().int(),
})
export type BatchAdoptResult = z.infer<typeof batchAdoptResultSchema>

/** `BatchAdoptOut` — respuesta 201 de `adopt-all-hosts`. */
export const batchAdoptOutSchema = z.object({
  username: z.string(),
  dialect: engineTypeSchema,
  total_hosts: z.number().int(),
  adopted: z.number().int(),
  results: z.array(batchAdoptResultSchema),
})
export type BatchAdoptOut = z.infer<typeof batchAdoptOutSchema>

/** Alcance de `define-password`: una identidad concreta o todos los hosts en vivo. */
export const definePasswordScopeSchema = z.enum(['host', 'all_hosts'])
export type DefinePasswordScope = z.infer<typeof definePasswordScopeSchema>

/**
 * `DefineKnownPasswordIn` — `POST /servers/{id}/users/define-password`. DEFINIR ≠ ROTAR:
 * cifra y guarda una contraseña que el admin YA conoce, sin tocar el motor (nunca `ALTER USER`).
 * El gateway NO verifica que sea la vigente — si es incorrecta, `reveal-password` devolverá
 * luego un valor erróneo sin que nadie lo detecte.
 */
export const defineKnownPasswordInSchema = z.object({
  username: z.string().min(1, 'Requerido'),
  scope: definePasswordScopeSchema,
  /** Solo si `scope='host'`. OJO: `%` es un host REAL, no un atajo de "todos los hosts". */
  host: z.string().regex(HOST_PATTERN, 'Host inválido').optional(),
  known_password: z.string().min(1, 'Requerido'),
  /** Crea la fila de inventario (adoptada) para hosts en vivo que aún no la tengan. */
  adopt_if_missing: z.boolean().optional(),
  /** OBLIGATORIO `true` para sobrescribir una identidad que ya tenía contraseña guardada. */
  overwrite: z.boolean().optional(),
})
export type DefineKnownPasswordIn = z.infer<typeof defineKnownPasswordInSchema>

/** `conflict_needs_overwrite` NO es error: la UI ofrece reenviar con `overwrite=true`. */
export const knownPasswordSetStatusSchema = z.enum([
  'updated',
  'adopted',
  'skipped_not_found',
  'conflict_needs_overwrite',
])
export type KnownPasswordSetStatus = z.infer<typeof knownPasswordSetStatusSchema>

export const knownPasswordSetResultSchema = z.object({
  host: z.string().nullable().optional(),
  status: knownPasswordSetStatusSchema,
  server_user_id: z.number().int().nullable().optional(),
})
export type KnownPasswordSetResult = z.infer<typeof knownPasswordSetResultSchema>

/** `KnownPasswordSetOut` — respuesta 200 de `define-password`. */
export const knownPasswordSetOutSchema = z.object({
  username: z.string(),
  scope: definePasswordScopeSchema,
  total_hosts: z.number().int(),
  updated: z.number().int(),
  results: z.array(knownPasswordSetResultSchema),
})
export type KnownPasswordSetOut = z.infer<typeof knownPasswordSetOutSchema>

/**
 * `EnginePasswordChangeAllHostsIn` — `PATCH /servers/{id}/users/password-all-hosts`.
 * `ALTER USER/ROLE` REAL en todos los hosts en vivo. `confirm_username` debe coincidir
 * EXACTO con `username` (doble intención).
 */
export const enginePasswordChangeAllHostsInSchema = z.object({
  username: z.string().min(1, 'Requerido'),
  new_password: z.string().min(1, 'Requerido'),
  confirm_username: z.string().min(1, 'Requerido'),
  adopt_if_missing: z.boolean().optional(),
})
export type EnginePasswordChangeAllHostsIn = z.infer<typeof enginePasswordChangeAllHostsInSchema>

export const passwordChangeBatchStatusSchema = z.enum(['rotated', 'error'])
export type PasswordChangeBatchStatus = z.infer<typeof passwordChangeBatchStatusSchema>

/** ⚠️ Un host con `status='error'` CONSERVA la contraseña ANTERIOR en el motor. */
export const passwordChangeBatchResultSchema = z.object({
  host: z.string().nullable().optional(),
  status: passwordChangeBatchStatusSchema,
  server_user_id: z.number().int().nullable().optional(),
  adopted: z.boolean(),
  error: z.string().nullable().optional(),
})
export type PasswordChangeBatchResult = z.infer<typeof passwordChangeBatchResultSchema>

/** `PasswordChangeBatchOut` — respuesta 200 de `password-all-hosts`. */
export const passwordChangeBatchOutSchema = z.object({
  username: z.string(),
  total_hosts: z.number().int(),
  updated: z.number().int(),
  results: z.array(passwordChangeBatchResultSchema),
})
export type PasswordChangeBatchOut = z.infer<typeof passwordChangeBatchOutSchema>

/** `EngineRevealPasswordIn` — `POST /servers/{id}/users/reveal-password`. */
export const engineRevealPasswordInSchema = z.object({
  username: z.string().min(1, 'Requerido'),
  host: z.string().regex(HOST_PATTERN, 'Host inválido').optional(),
})
export type EngineRevealPasswordIn = z.infer<typeof engineRevealPasswordInSchema>

/** Secreto efímero: nunca debe persistirse fuera del estado local del componente que lo pidió. */
export const engineRevealPasswordOutSchema = z.object({
  username: z.string(),
  host: z.string().nullable().optional(),
  password: z.string(),
})
export type EngineRevealPasswordOut = z.infer<typeof engineRevealPasswordOutSchema>
