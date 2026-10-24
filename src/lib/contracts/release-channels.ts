import { z } from 'zod'

/**
 * Canales de liberación de blueprints (`stable`, `development`…): catálogo GLOBAL que decide qué
 * versión de un blueprint consumen las integraciones. Este módulo cubre el catálogo; el puntero de
 * cada blueprint (promover, historial) es otra superficie.
 *
 * El catálogo es configuración del gateway: ninguna operación de acá toca un motor de BD.
 */

/** Tope del nombre y del slug en el backend (`app/schemas/release_channel.py`). */
export const RELEASE_CHANNEL_NAME_MAX = 60
export const RELEASE_CHANNEL_SLUG_MAX = 60

/**
 * Mismo patrón que valida el backend. Se replica porque en producción el 422 de Pydantic no trae
 * detalle por campo: sin este chequeo, el único texto disponible sería «Error de validación».
 */
export const RELEASE_CHANNEL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$|^[a-z0-9]$/

/**
 * Cómo se resuelve la versión de un canal. Vocabulario cerrado, no un ENUM de BD: cada modo tiene
 * código propio en el resolver del backend.
 */
export const RELEASE_CHANNEL_MODES = ['manual', 'derived', 'latest'] as const
export const releaseChannelModeSchema = z.enum(RELEASE_CHANNEL_MODES)
export type ReleaseChannelMode = z.infer<typeof releaseChannelModeSchema>

/**
 * `ReleaseChannelOut`.
 *
 * `resolution_mode` se lee como `string` y NO como `releaseChannelModeSchema`: el backend lo tipa
 * `str`, y el día que agregue un modo, un `z.enum` duro rechazaría el envelope entero y
 * desaparecería el catálogo completo. La tabla degrada mostrando el valor crudo; los formularios
 * sí usan el enum cerrado porque solo envían modos que esta SPA conoce.
 *
 * `environment_id` es `nullable` y `optional`: el backend omite las claves nulas en la raíz del
 * envelope pero dentro de `data` las manda como `null`; se aceptan ambas formas.
 */
export const releaseChannelOutSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  resolution_mode: z.string(),
  environment_id: z.number().int().nullable().optional().default(null),
  /** Punteros de blueprint del canal. Mayor que cero = borrar exige repetir el slug. */
  pointer_count: z.number().int().optional().default(0),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ReleaseChannelOut = z.infer<typeof releaseChannelOutSchema>

const nameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre no puede ser solo espacios.')
  .max(RELEASE_CHANNEL_NAME_MAX, `Máximo ${RELEASE_CHANNEL_NAME_MAX} caracteres`)

/** Un canal `derived` es la mínima versión viva de un entorno: sin entorno no hay nada que medir. */
const DERIVED_REQUIRES_ENVIRONMENT_MESSAGE = 'Un canal derivado necesita un entorno enlazado.'

/**
 * Body de `POST /release-channels`. El slug se normaliza (recorte y minúsculas) igual que en el
 * backend, así que el patrón se evalúa sobre el valor ya normalizado.
 */
export const releaseChannelCreateSchema = z
  .object({
    name: nameSchema,
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, 'Requerido')
      .max(RELEASE_CHANNEL_SLUG_MAX, `Máximo ${RELEASE_CHANNEL_SLUG_MAX} caracteres`)
      .regex(
        RELEASE_CHANNEL_SLUG_PATTERN,
        'Minúsculas, dígitos y guiones, empezando y terminando en letra o dígito.',
      ),
    resolution_mode: releaseChannelModeSchema,
    environment_id: z.number().int().positive().nullable(),
  })
  .refine((value) => value.resolution_mode !== 'derived' || value.environment_id !== null, {
    path: ['environment_id'],
    message: DERIVED_REQUIRES_ENVIRONMENT_MESSAGE,
  })
export type ReleaseChannelCreate = z.infer<typeof releaseChannelCreateSchema>

/**
 * Body de `PATCH /release-channels/{id}`. **No incluye `slug`**: es inmutable, porque renombrarlo
 * rompería a toda integración que ya lo cita sin que nada falle al hacerlo.
 *
 * `environment_id: null` desvincula el entorno; omitir la clave lo deja intacto. El formulario
 * manda siempre las tres claves, así que el null es una decisión explícita de la persona.
 */
export const releaseChannelUpdateSchema = z
  .object({
    name: nameSchema,
    resolution_mode: releaseChannelModeSchema,
    environment_id: z.number().int().positive().nullable(),
  })
  .refine((value) => value.resolution_mode !== 'derived' || value.environment_id !== null, {
    path: ['environment_id'],
    message: DERIVED_REQUIRES_ENVIRONMENT_MESSAGE,
  })
export type ReleaseChannelUpdate = z.infer<typeof releaseChannelUpdateSchema>

/**
 * Vocabulario cerrado de `detail.public_context.code` del módulo
 * (`app/services/release_channel_catalog.py`). Se clasifica siempre por este código, nunca por la
 * prosa del mensaje. Incluye los que emite el puntero de cada blueprint: el mapa de textos vive en
 * `features/release-channels/messages.ts`.
 */
export const RELEASE_CHANNEL_ERROR_CODES = {
  notFound: 'release_channel.not_found',
  nameTaken: 'release_channel.name_taken',
  slugTaken: 'release_channel.slug_taken',
  environmentRequired: 'release_channel.environment_required',
  confirmationRequired: 'release_channel.confirmation_required',
  notManual: 'release_channel.not_manual',
  versionNotFound: 'release_channel.version_not_found',
  versionNotInBlueprint: 'release_channel.version_not_in_blueprint',
  versionUnreviewed: 'release_channel.version_unreviewed',
  promoteBackwardRequiresConfirm: 'release_channel.promote_backward_requires_confirm',
  noReleasedVersion: 'release_channel.no_released_version',
  derivedUnreadable: 'release_channel.derived_unreadable',
  derivedNoScope: 'release_channel.derived_no_scope',
  pointerInconsistent: 'release_channel.pointer_inconsistent',
  targetConflict: 'release_channel.target_conflict',
} as const

// ── Puntero de cada blueprint: resolución, promoción e historial ─────────────────

/**
 * Estado de UNA base dentro del cálculo de un canal `derived` (`ChannelDatabaseStateOut`).
 *
 * `counted: false` + `ignored_reason` explica por qué una base no entró en el mínimo
 * (`quarantined`, `database_missing`, `at_base`). `readable: false` es una base que SÍ cuenta pero
 * cuya versión no se pudo leer: es lo que vuelve `derived_unreadable` al canal.
 */
export const channelDatabaseStateSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string(),
  current_version: z.string().nullish(),
  readable: z.boolean(),
  counted: z.boolean(),
  ignored_reason: z.string().nullish(),
})

/**
 * `ChannelReferenceOut`: el mínimo de las bases VIVAS de un entorno, mostrado junto al puntero de
 * un canal manual. Es una REFERENCIA para la persona: en un canal manual no decide nada.
 *
 * Los nulos de `data` viajan como `null` explícito (solo el envelope los omite), de ahí `nullish`.
 */
export const channelReferenceSchema = z.object({
  environment_slug: z.string().nullish(),
  resolved: z.boolean(),
  code: z.string().nullish(),
  version: z.string().nullish(),
  model_migration_id: z.number().int().nullish(),
  /** `live` (lectura en vivo) o `inventory_cache` (listado). Un valor nuevo se muestra crudo. */
  source: z.string().nullish(),
  databases: z.array(channelDatabaseStateSchema).optional().default([]),
})
export type ChannelReference = z.infer<typeof channelReferenceSchema>

/**
 * `ChannelResolutionOut`: qué versión sirve un canal para un blueprint.
 *
 * `resolved: false` NO es un error HTTP: el listado y el endpoint de lectura siempre responden 200
 * y dicen en `code` por qué no hay versión. `resolution_mode` y `source` se leen como `string` por
 * el mismo motivo que en `releaseChannelOutSchema`: un valor nuevo del backend no debe tumbar la
 * lista entera de canales.
 */
export const channelResolutionOutSchema = z.object({
  channel_slug: z.string(),
  channel_name: z.string(),
  resolution_mode: z.string(),
  environment_slug: z.string().nullish(),
  resolved: z.boolean(),
  code: z.string().nullish(),
  version: z.string().nullish(),
  model_migration_id: z.number().int().nullish(),
  /** `pointer` | `tip` | `live` | `inventory_cache`. */
  source: z.string().nullish(),
  databases: z.array(channelDatabaseStateSchema).optional().default([]),
  derived_reference: channelReferenceSchema.nullish(),
})
export type ChannelResolutionOut = z.infer<typeof channelResolutionOutSchema>

/**
 * `ResolvedChannelOut`: qué versión sirvió un canal al momento de una operación (alta de base,
 * lote de migraciones). El canal es un puntero que se mueve, así que esta foto es lo único que fija
 * qué significaba el canal entonces.
 */
export const resolvedChannelSchema = z.object({
  slug: z.string(),
  mode: z.string(),
  version: z.string(),
  source: z.string().nullish(),
})
export type ResolvedChannel = z.infer<typeof resolvedChannelSchema>

/**
 * Body de `POST .../channels/{slug}/promote`. El backend exige exactamente uno de `version` o
 * `model_migration_id`; la pantalla manda siempre `version`, que es lo que ve la persona.
 */
export const channelPromoteInSchema = z.object({
  version: z.string().regex(/^\d{4,10}$/, 'Cuatro a diez dígitos, como 0007'),
  note: z.string().trim().max(500, 'Máximo 500 caracteres').nullable().optional(),
})
export type ChannelPromoteIn = z.infer<typeof channelPromoteInSchema>

/** `ChannelPromoteOut`. `changed: false` = el canal ya apuntaba ahí: no hubo escritura ni evento. */
export const channelPromoteOutSchema = z.object({
  channel_slug: z.string(),
  changed: z.boolean(),
  event_type: z.string().nullish(),
  from_version: z.string().nullish(),
  to_version: z.string(),
  model_migration_id: z.number().int(),
})
export type ChannelPromoteOut = z.infer<typeof channelPromoteOutSchema>

/** Tipos de evento del historial de un puntero. Vocabulario del backend, no un enum duro. */
export const CHANNEL_EVENT_TYPES = {
  promote: 'promote',
  demote: 'demote',
  versionDeleted: 'version_deleted',
} as const

/**
 * `ChannelPointerEventOut`. `from_version`/`to_version` son una FOTO de la etiqueta al momento del
 * evento: un renumerado posterior no la reescribe, así que pueden no coincidir con la numeración de
 * hoy y por eso se muestran tal cual.
 */
export const channelPointerEventOutSchema = z.object({
  id: z.number().int(),
  event_type: z.string(),
  from_migration_id: z.number().int().nullish(),
  to_migration_id: z.number().int().nullish(),
  from_version: z.string().nullish(),
  to_version: z.string().nullish(),
  note: z.string().nullish(),
  actor_admin_id: z.number().int().nullish(),
  actor_username: z.string(),
  actor_type: z.string(),
  created_at: z.string(),
})
export type ChannelPointerEventOut = z.infer<typeof channelPointerEventOutSchema>
