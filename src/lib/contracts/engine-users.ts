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
    new_host: z
      .string()
      .min(1, 'Requerido')
      .regex(HOST_PATTERN, 'Host inválido (`%` = wildcard)'),
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
