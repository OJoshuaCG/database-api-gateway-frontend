import { z } from 'zod'

/**
 * Tokens de integración (`/integration-tokens`): credenciales portadoras con las que una aplicación
 * web o un pipeline PROPIO opera el gateway por la API `/integration/*` (crear bases y usuarios del
 * motor, aplicar migraciones). Son un tipo independiente de los tokens de agente del MCP: otro
 * vocabulario de scopes, otro prefijo de bearer (`datumint.`) y otro techo.
 *
 * Todo el módulo va detrás de `access.admin` (ve y revoca los de todos) o `integration_tokens.own`
 * (solo los que emitió la propia persona). El servidor filtra por dueño: la SPA no recorta nada.
 * Los guards de la pantalla son una pista (ADR-0007), decide el servidor.
 */

/**
 * El vocabulario cerrado de scopes. Es solo tipado y orden de lectura: lo que un usuario puede
 * OFRECER lo decide siempre `GET /integration-tokens/ceiling`, nunca esta lista.
 */
export const INTEGRATION_SCOPES = [
  'servers.list',
  'databases.list',
  'blueprint.read_assigned',
  'migrations.read_version',
  'databases.create',
  'engine_users.create',
  'engine_users.assign_profile',
  'engine_users.assign_database',
  'databases.assign_blueprint',
  'migrations.apply_forward',
  'migrations.rollback',
  'migrations.stamp',
] as const
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number]

/** `read` no muta, `write` muta de forma recuperable, `destructive` puede perder datos. */
export const INTEGRATION_SCOPE_TIERS = ['read', 'write', 'destructive'] as const
export type IntegrationScopeTier = (typeof INTEGRATION_SCOPE_TIERS)[number]

/**
 * Tier de cada scope según el catálogo del backend. Existe para lo que se dibuja SIN techo propio:
 * el listado de un `access.admin` trae scopes de tokens ajenos que su techo no necesariamente
 * ofrece. El selector del formulario agrupa por el `tier` que informa el servidor, no por esto.
 */
export const INTEGRATION_SCOPE_TIER_BY_SCOPE: Readonly<
  Record<IntegrationScope, IntegrationScopeTier>
> = {
  'servers.list': 'read',
  'databases.list': 'read',
  'blueprint.read_assigned': 'read',
  'migrations.read_version': 'read',
  'databases.create': 'write',
  'engine_users.create': 'write',
  'engine_users.assign_profile': 'write',
  'engine_users.assign_database': 'write',
  'databases.assign_blueprint': 'write',
  'migrations.apply_forward': 'write',
  'migrations.rollback': 'destructive',
  'migrations.stamp': 'destructive',
}

/** Los scopes del tier destructivo: revertir migraciones y marcar versiones sin ejecutar SQL. */
export const INTEGRATION_DESTRUCTIVE_SCOPES: readonly IntegrationScope[] =
  INTEGRATION_SCOPES.filter((scope) => INTEGRATION_SCOPE_TIER_BY_SCOPE[scope] === 'destructive')

/** ¿Es un scope destructivo conocido? Un valor fuera del vocabulario NO lo es. */
export function isDestructiveIntegrationScope(scope: string): boolean {
  return (INTEGRATION_DESTRUCTIVE_SCOPES as readonly string[]).includes(scope)
}

export const INTEGRATION_TOKEN_NAME_MIN = 3
export const INTEGRATION_TOKEN_NAME_MAX = 128

/**
 * `IntegrationTokenOut`.
 *
 * ⚠️ `id` y `token_id` NO son lo mismo: `id` es la PK numérica y va en `PATCH`/`DELETE`;
 * `token_id` es la parte PÚBLICA del bearer (`datumint.<token_id>.<secreto>`) y es lo que muestra
 * la auditoría.
 *
 * `scopes` son los EFECTIVOS hoy; `suspended_scopes` son los guardados que el emisor ya no tiene
 * (o que están fuera del vocabulario). Solo viene poblado en los tokens PROPIOS de quien mira:
 * en los ajenos el servidor no lo calcula, porque revelaría el rol actual de otra persona.
 */
export const integrationTokenOutSchema = z.object({
  id: z.number().int(),
  token_id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()).default([]),
  suspended_scopes: z.array(z.string()).default([]),
  server_ids: z.array(z.number().int()).default([]),
  blueprint_ids: z.array(z.number().int()).default([]),
  created_by_admin_id: z.number().int(),
  /** `null` = token sin expiración (solo si el despliegue lo permite). */
  expires_at: z.string().nullable(),
  last_used_at: z.string().nullable().optional(),
  revoked_at: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  /** Lo calcula el backend (no revocado Y no vencido): no se recalcula en la UI. */
  active: z.boolean(),
  created_at: z.string().nullable().optional(),
})
export type IntegrationTokenOut = z.infer<typeof integrationTokenOutSchema>

/**
 * `IntegrationTokenCreatedOut` — `IntegrationTokenOut` MÁS el bearer completo.
 *
 * ⚠️ `token` viaja SOLO en el `POST` y una sola vez. El servidor guarda únicamente su HMAC: no hay
 * endpoint que lo vuelva a mostrar.
 */
export const integrationTokenCreatedOutSchema = integrationTokenOutSchema.extend({
  token: z.string(),
})
export type IntegrationTokenCreatedOut = z.infer<typeof integrationTokenCreatedOutSchema>

/**
 * `IntegrationTokenCreate`. El servidor usa `extra="forbid"`, así que el esquema es estricto: un
 * campo mal escrito falla acá y no se descarta en silencio.
 *
 * `server_ids` es obligatorio SIEMPRE (un token sin servidores no alcanza nada). `blueprint_ids`
 * vacío significa «sin restricción de blueprint», salvo con un scope destructivo, que exige al
 * menos uno. `expires_in_days` omitido NO es «sin vencimiento»: el servidor aplica el tope del tier.
 * Sin vencimiento se pide EXPLÍCITO con `never_expires: true` (excluyente con `expires_in_days`).
 */
export const integrationTokenCreateSchema = z.strictObject({
  name: z
    .string()
    .min(INTEGRATION_TOKEN_NAME_MIN, `Mínimo ${INTEGRATION_TOKEN_NAME_MIN} caracteres`)
    .max(INTEGRATION_TOKEN_NAME_MAX, `Máximo ${INTEGRATION_TOKEN_NAME_MAX} caracteres`),
  scopes: z.array(z.string()).min(1, 'Elegí al menos un permiso'),
  server_ids: z.array(z.number().int()).min(1, 'Elegí al menos un servidor'),
  blueprint_ids: z.array(z.number().int()).optional(),
  expires_in_days: z.number().int().min(1, 'Mínimo 1 día').optional(),
  never_expires: z.boolean().optional(),
  note: z.string().nullable().optional(),
})
export type IntegrationTokenCreate = z.infer<typeof integrationTokenCreateSchema>

/**
 * `IntegrationTokenUpdate` — `PATCH /integration-tokens/{token_pk}`. Cada campo enviado REEMPLAZA
 * al guardado: `scopes` es la lista COMPLETA. El secreto y el vencimiento no cambian nunca, y por
 * eso `expires_in_days` no existe acá.
 */
export const integrationTokenUpdateSchema = z.strictObject({
  name: z
    .string()
    .min(INTEGRATION_TOKEN_NAME_MIN, `Mínimo ${INTEGRATION_TOKEN_NAME_MIN} caracteres`)
    .max(INTEGRATION_TOKEN_NAME_MAX, `Máximo ${INTEGRATION_TOKEN_NAME_MAX} caracteres`)
    .optional(),
  scopes: z.array(z.string()).min(1, 'Elegí al menos un permiso').optional(),
  server_ids: z.array(z.number().int()).min(1, 'Elegí al menos un servidor').optional(),
  blueprint_ids: z.array(z.number().int()).optional(),
  note: z.string().nullable().optional(),
})
export type IntegrationTokenUpdate = z.infer<typeof integrationTokenUpdateSchema>

/**
 * Un scope que el emisor puede otorgar hoy. Los que NO tiene están AUSENTES: ni entrada, ni marca,
 * ni conteo. Un selector que los deshabilitara diría qué capacidades existen más allá de su rol.
 */
export const integrationScopeCeilingEntrySchema = z.object({
  scope: z.string(),
  label: z.string(),
  mutates: z.boolean(),
  tier: z.enum(INTEGRATION_SCOPE_TIERS),
})
export type IntegrationScopeCeilingEntry = z.infer<typeof integrationScopeCeilingEntrySchema>

/**
 * `GET /integration-tokens/ceiling`: qué se puede poner en un token nuevo, los topes de vida por
 * tier y si la API está encendida (`enabled=false` = kill switch del servidor apagado).
 */
export const integrationCeilingOutSchema = z.object({
  enabled: z.boolean(),
  scopes: z.array(integrationScopeCeilingEntrySchema),
  max_ttl_days: z.number().int(),
  max_write_ttl_days: z.number().int(),
  max_destructive_ttl_days: z.number().int(),
  /** El despliegue permite emitir tokens sin expiración (nunca con permisos destructivos). */
  allow_non_expiring: z.boolean().default(false),
})
export type IntegrationCeilingOut = z.infer<typeof integrationCeilingOutSchema>

/**
 * Códigos de `detail.public_context.code`. `ttlTooLong` trae `public_context.max_days`.
 * `disabled` (503) es el kill switch: con él apagado el alta y la edición responden 503, pero el
 * listado y la revocación siguen andando.
 */
export const INTEGRATION_TOKEN_ERROR_CODES = {
  disabled: 'integration.disabled',
  notFound: 'integration_token.not_found',
  ttlTooLong: 'integration_token.ttl_too_long',
  scopeNotAllowed: 'integration_token.scope_not_allowed',
  unknownScope: 'integration_token.unknown_scope',
  serverAllowlistRequired: 'integration_token.server_allowlist_required',
  blueprintAllowlistRequired: 'integration_token.blueprint_allowlist_required',
  serverNotFound: 'integration_token.server_not_found',
  blueprintNotFound: 'integration_token.blueprint_not_found',
  alreadyRevoked: 'integration_token.already_revoked',
} as const
