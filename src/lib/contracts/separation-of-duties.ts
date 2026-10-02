import { z } from 'zod'

/**
 * Separación de deberes (api-reference-v29 §8, C2).
 *
 * Una cuenta con `security_officer` (escribe la política: entornos, catálogos, servidores,
 * cifrado) no puede tener además `owner` en ninguna forma ni `access_admin`. Los escritores de
 * acceso responden `409 access.sod_conflict` si el estado RESULTANTE viola una regla que ninguna
 * excepción viva cubre, salvo un `sod_override` (break-glass auditado, vence en 7 días como
 * mucho). Al leer, una cuenta que viola una regla sin excepción pierde las capacidades de
 * `security_officer` (falla cerrado).
 */

// ── Reglas ─────────────────────────────────────────────────────────────────────
/**
 * Las dos reglas, con los ids del backend (`SOD_RULE_OWNER` y `SOD_RULE_ACCESS_ADMIN` de
 * `capability_catalog.py`). En las RESPUESTAS el campo va `z.string()`: una regla nueva no puede
 * tumbar `/auth/me`, que sostiene la sesión entera. La UI cae a mostrar el id.
 */
export const SOD_RULES = {
  owner: 'owner_security_officer',
  accessAdmin: 'access_admin_security_officer',
} as const
export type SodRule = (typeof SOD_RULES)[keyof typeof SOD_RULES]

// ── Break-glass ────────────────────────────────────────────────────────────────
/** Límites del override (`sod_service.py`): una frase de motivo, no «ok», y a lo sumo 7 días. */
export const SOD_OVERRIDE_REASON_MIN = 20
export const SOD_OVERRIDE_REASON_MAX = 500
export const SOD_OVERRIDE_MAX_HOURS = 168

/**
 * `SodOverrideIn`. Va en `POST`/`PATCH /gateway-users`, `PUT /gateway-users/{id}/access` y
 * `POST /gateway-users/{id}/capability-grants` (no en `approve`). Sin conflicto el backend lo
 * ignora: no escribe una excepción que no exceptúa nada.
 *
 * El backend valida el motivo DESPUÉS de `strip()`, así que se valida igual acá: veinte espacios
 * no son un motivo.
 */
export const sodOverrideInSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(SOD_OVERRIDE_REASON_MIN, `Mínimo ${SOD_OVERRIDE_REASON_MIN} caracteres`)
    .max(SOD_OVERRIDE_REASON_MAX, `Máximo ${SOD_OVERRIDE_REASON_MAX} caracteres`),
  expires_in_hours: z
    .number()
    .int('Tiene que ser un número entero de horas')
    .min(1, 'Mínimo 1 hora')
    .max(SOD_OVERRIDE_MAX_HOURS, `Máximo ${SOD_OVERRIDE_MAX_HOURS} horas (7 días)`)
    .optional(),
})
export type SodOverrideIn = z.infer<typeof sodOverrideInSchema>

// ── `/auth/me.sod_warnings` ────────────────────────────────────────────────────
/**
 * Estado de una regla que la cuenta de la sesión viola:
 * - `grandfathered`: combinación heredada de antes de la regla, sin vencimiento.
 * - `override`: break-glass vigente; `expires_at` dice cuándo vence.
 * - `neutralized`: sin excepción, así que el servidor ya le descartó `security_officer`.
 */
export const SOD_WARNING_STATUSES = ['grandfathered', 'override', 'neutralized'] as const

/** `SodWarningOut`. Fechas en UTC sin zona: se leen con `parseUtcInstant`. */
export const sodWarningSchema = z.object({
  rule: z.string(),
  /** `z.string()`: un estado nuevo no tumba la sesión; la UI cae a un texto genérico. */
  status: z.string(),
  reason: z.string().nullish(),
  since: z.string().nullish(),
  expires_at: z.string().nullish(),
})
export type SodWarning = z.infer<typeof sodWarningSchema>

// ── `GET /authz/sod-report` (`access.admin`) ───────────────────────────────────
export const sodUserRefSchema = z.object({
  id: z.number().int(),
  username: z.string(),
})
export type SodUserRef = z.infer<typeof sodUserRefSchema>

/** Una excepción VIVA: heredada (`grandfathered`) u override de break-glass. */
export const sodExceptionSchema = z.object({
  id: z.number().int(),
  user: sodUserRefSchema,
  /** `null` si la cuenta ya no tiene `security_officer`. */
  user_active: z.boolean().nullish(),
  rule: z.string(),
  kind: z.string(),
  reason: z.string(),
  since: z.string().nullish(),
  /** `null` = heredada, sin vencimiento. */
  expires_at: z.string().nullish(),
  requested_by: sodUserRefSchema.nullish(),
  /** Siempre `null` en C2: el segundo aprobador del override llega en C3. */
  approved_by: sodUserRefSchema.nullish(),
  /** `false` = la cuenta ya no viola la regla; la excepción sobra y se cierra sola. */
  still_violating: z.boolean(),
})
export type SodException = z.infer<typeof sodExceptionSchema>

/** Una cuenta que viola una regla SIN excepción: al leer ya se le descartó `security_officer`. */
export const sodUncoveredSchema = z.object({
  user: sodUserRefSchema,
  user_active: z.boolean(),
  rules: z.array(z.string()),
})
export type SodUncovered = z.infer<typeof sodUncoveredSchema>

export const sodReportSchema = z.object({
  exceptions: z
    .array(sodExceptionSchema)
    .nullish()
    .transform((value) => value ?? []),
  uncovered: z
    .array(sodUncoveredSchema)
    .nullish()
    .transform((value) => value ?? []),
})
export type SodReport = z.infer<typeof sodReportSchema>

// ── Códigos de error ───────────────────────────────────────────────────────────
/**
 * - `conflict` (409): el estado resultante viola una regla sin excepción. `public_context` trae
 *   `rules`, `conflicts[{rule, sources}]` y `override {field, reason_min_length, max_hours}`.
 *   También llega como `blocked_reason` de una solicitud pendiente que no se puede aprobar.
 * - `overrideInvalid` (422): el `sod_override` no cumple los límites (`reason_min_length`,
 *   `max_hours`).
 */
export const SOD_ERROR_CODES = {
  conflict: 'access.sod_conflict',
  overrideInvalid: 'access.sod_override_invalid',
} as const
