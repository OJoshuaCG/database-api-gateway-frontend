import { z } from 'zod'

/**
 * Tokens de agente (addendum de identidades §3): credenciales portadoras con las que un proceso
 * automático —un pipeline de CI, un agente MCP— habla con el gateway sin sesión de usuario.
 * Todo el módulo va detrás de `gateway.admin`.
 */

/** Scope efectivo cuando el alta manda la lista vacía. NO es «sin scopes». */
export const API_TOKEN_DEFAULT_SCOPE = 'blueprints.read'

/** Vencimiento que aplica el backend cuando `expires_in_days` se omite. NO es «sin vencimiento». */
export const API_TOKEN_DEFAULT_TTL_DAYS = 90

/** Tope de `expires_in_days`. El 422 `ttl_too_long` lo confirma en `public_context.max_days`. */
export const API_TOKEN_MAX_TTL_DAYS = 90

export const API_TOKEN_NAME_MIN = 3
export const API_TOKEN_NAME_MAX = 128

/**
 * `ApiTokenOut` (§3).
 *
 * ⚠️ `id` y `token_id` NO son lo mismo, y confundirlos rompe el `DELETE`. `id` es la PK numérica
 * y es lo que va en `DELETE /api-tokens/{token_pk}`. `token_id` es la parte PÚBLICA del bearer
 * (`dbgw.<token_id>.<secreto>`) y es lo que aparece en el rastro de auditoría: sirve para cruzar
 * una fila `mcp.*` con el token que la originó, no para direccionar el recurso.
 *
 * ⚠️ `scopes` son los EFECTIVOS, no el eco del request: el servidor intersecta lo pedido con el
 * techo de agente, así que puede traer MENOS de lo que se envió. La pantalla tiene que mostrar lo
 * que devolvió el servidor y nunca lo que el operador eligió — mostrar el pedido convierte la
 * revisión de accesos en una afirmación falsa.
 */
export const apiTokenOutSchema = z.object({
  id: z.number().int(),
  token_id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()).optional().default([]),
  project_id: z.number().int(),
  expires_at: z.string().nullable().optional(),
  last_used_at: z.string().nullable().optional(),
  revoked_at: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  /** `revoked_at` nulo Y `expires_at` futuro. Lo calcula el backend: no lo recalcules en la UI. */
  active: z.boolean(),
  created_at: z.string(),
})
export type ApiTokenOut = z.infer<typeof apiTokenOutSchema>

/**
 * `ApiTokenCreatedOut` (§3) — `ApiTokenOut` MÁS el bearer completo.
 *
 * ⚠️ `token` viaja SOLO en el POST y una sola vez. No hay endpoint que lo vuelva a mostrar: si la
 * pantalla no lo entrega, el token queda emitido, ocupando su fila en el listado, y es inservible.
 */
export const apiTokenCreatedOutSchema = apiTokenOutSchema.extend({
  token: z.string(),
})
export type ApiTokenCreatedOut = z.infer<typeof apiTokenCreatedOutSchema>

/**
 * `ApiTokenCreate` (§3).
 *
 * `project_id` es obligatorio porque un token sin proyecto no alcanzaría ninguna base. `scopes`
 * vacío NO significa «sin permisos»: el servidor lo resuelve a `[blueprints.read]`. Y omitir
 * `expires_in_days` NO significa «sin vencimiento»: son 90 días. Las dos cosas tienen que estar en
 * el copy del formulario, y el default de vencimiento visible debería ser un número, no un campo
 * vacío.
 */
export const apiTokenCreateSchema = z.object({
  name: z
    .string()
    .min(API_TOKEN_NAME_MIN, `Mínimo ${API_TOKEN_NAME_MIN} caracteres`)
    .max(API_TOKEN_NAME_MAX, `Máximo ${API_TOKEN_NAME_MAX} caracteres`),
  project_id: z.number().int().min(1, 'Selecciona un proyecto'),
  scopes: z.array(z.string()).optional(),
  expires_in_days: z
    .number()
    .int()
    .min(1, 'Mínimo 1 día')
    .max(API_TOKEN_MAX_TTL_DAYS, `Máximo ${API_TOKEN_MAX_TTL_DAYS} días`)
    .optional(),
  note: z.string().nullable().optional(),
})
export type ApiTokenCreate = z.infer<typeof apiTokenCreateSchema>

/**
 * Códigos de `detail.public_context.code` (§3).
 *
 * `ttlTooLong` trae `public_context.max_days`; `scopeNotAllowed` trae `public_context.allowed[]`
 * con el TECHO DE AGENTE completo — que es exactamente el conjunto de opciones que debería ofrecer
 * el selector de scopes, sin hardcodear nada.
 *
 * ⚠️ `scopeNotAllowed` llega también cuando el string no es una capacidad conocida (un typo), y en
 * ESE caso no trae `allowed[]`. Si el selector se alimenta del backend, ese caso no debería ocurrir.
 */
export const API_TOKEN_ERROR_CODES = {
  projectRequired: 'api_token.project_required',
  ttlTooLong: 'api_token.ttl_too_long',
  scopeNotAllowed: 'api_token.scope_not_allowed',
  notFound: 'api_token.not_found',
  alreadyRevoked: 'api_token.already_revoked',
} as const
