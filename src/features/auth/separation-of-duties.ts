import type { ApiSodConflict, ApiSodSource } from '@/lib/api/errors'
import { SOD_RULES, type CapabilityDescriptor, type SodWarning } from '@/lib/contracts'
import { formatDateTime } from '@/lib/utils/format'
import { globalCapabilityLabel, type ScopeGrant } from './authz-model'
import { parseUtcInstant } from './step-up'

/**
 * Separación de deberes (api-reference-v29 §8): **espejo de `app/core/separation_of_duties.py`**
 * del backend, regla por regla, para AVISAR antes de guardar. Decide el servidor, siempre: esto
 * solo evita llevar a alguien hasta un 409 sin saber por qué.
 *
 * La regla: una cuenta con `security_officer` no puede tener además
 * - `owner` en ninguna forma (`owner_security_officer`): rol base `owner`, un rol `owner` por
 *   alcance, o una capacidad puntual viva exclusiva de `owner`;
 * - `access_admin` (`access_admin_security_officer`).
 *
 * Las fuentes tienen la misma forma que `public_context.conflicts[].sources` del 409, así que el
 * aviso previo y el rechazo del servidor se pintan con el mismo código.
 */

/** Una regla violada con lo que choca. Misma forma que la del 409 ya normalizado. */
export type SodConflict = ApiSodConflict
export type SodSource = ApiSodSource

const SECURITY_OFFICER = 'security_officer'
const ACCESS_ADMIN = 'access_admin'
const OWNER = 'owner'

/**
 * Capacidades exclusivas de `owner`: las que tiene `owner` y no `operator`
 * (`OWNER_ONLY_CAPABILITIES = _OWNER - _OPERATOR` en `capability_catalog.py`). Salen del catálogo,
 * no de una lista: si el backend mueve una capacidad de rol, el aviso lo sigue solo.
 */
export function ownerOnlyCapabilityIds(catalog: readonly CapabilityDescriptor[]): string[] {
  return catalog
    .filter((row) => row.roles.includes(OWNER) && !row.roles.includes('operator'))
    .map((row) => row.id)
}

/** Una capacidad puntual, con lo único que la regla necesita. */
export interface SodCapabilityGrant {
  capability: string
  scopeType: string
  scopeId: number
}

export interface SodStateInput {
  baseRole: string | null | undefined
  scopeGrants?: readonly ScopeGrant[]
  globalCapabilities: readonly string[]
  /**
   * Capacidades puntuales que cuentan. Al ESCRIBIR, el backend cuenta las vivas (pendientes y
   * activas), porque una pendiente surte efecto en cuanto se aprueba: quien llama filtra.
   */
  capabilityGrants?: readonly SodCapabilityGrant[]
  /** `ownerOnlyCapabilityIds(catalog)`. Sin catálogo, las puntuales no se pueden evaluar. */
  ownerOnlyCapabilities?: readonly string[]
}

/**
 * Las reglas que el estado viola, ordenadas por id como las publica el 409. Vacío si no viola
 * ninguna. Sin `security_officer` no hay nada que chequear.
 */
export function sodConflicts(input: SodStateInput): SodConflict[] {
  if (!input.globalCapabilities.includes(SECURITY_OFFICER)) return []

  const ownerOnly = new Set(input.ownerOnlyCapabilities ?? [])
  const owner: SodSource[] = []
  if (input.baseRole === OWNER) owner.push({ kind: 'base_role', role: OWNER })
  for (const grant of input.scopeGrants ?? []) {
    if (grant.role === OWNER) {
      owner.push({
        kind: 'scope_grant',
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
        role: OWNER,
      })
    }
  }
  for (const grant of input.capabilityGrants ?? []) {
    if (ownerOnly.has(grant.capability)) {
      owner.push({
        kind: 'capability_grant',
        capability: grant.capability,
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
      })
    }
  }

  const out: SodConflict[] = []
  if (owner.length > 0) out.push({ rule: SOD_RULES.owner, sources: owner })
  if (input.globalCapabilities.includes(ACCESS_ADMIN)) {
    out.push({
      rule: SOD_RULES.accessAdmin,
      sources: [{ kind: 'global_capability', globalCapability: ACCESS_ADMIN }],
    })
  }
  return out.sort((a, b) => a.rule.localeCompare(b.rule))
}

/** Las violadas que ninguna excepción viva cubre (`uncovered` del backend). */
export function uncoveredSodConflicts(
  conflicts: readonly SodConflict[],
  coveredRules: Iterable<string>,
): SodConflict[] {
  const covered = new Set(coveredRules)
  return conflicts.filter((conflict) => !covered.has(conflict.rule))
}

// ── Copy ───────────────────────────────────────────────────────────────────────

/** La regla en una frase, para todo aviso o rechazo de separación de deberes. */
export const SOD_RULE_EXPLANATION =
  'Una misma cuenta no puede ser oficial de seguridad y a la vez owner (o administrar accesos): quien escribe la política del gateway no puede ser también quien opera producción ni quien reparte los accesos, porque podría apagarse sus propias barreras.'

const RULE_PAIRS: Record<string, string> = {
  [SOD_RULES.owner]: 'oficial de seguridad y owner',
  [SOD_RULES.accessAdmin]: 'oficial de seguridad y administración de accesos',
}

/** «oficial de seguridad y owner»; una regla desconocida cae a su id. */
export function sodRulePair(rule: string): string {
  return RULE_PAIRS[rule] ?? rule
}

const RULE_LABELS: Record<string, string> = {
  [SOD_RULES.owner]: 'Oficial de seguridad + owner',
  [SOD_RULES.accessAdmin]: 'Oficial de seguridad + administración de accesos',
}

/** Título corto de una regla: «Oficial de seguridad + owner». */
export function sodRuleLabel(rule: string): string {
  return RULE_LABELS[rule] ?? rule
}

const SCOPE_TYPE_LABELS: Record<string, string> = {
  environment: 'el entorno',
  server: 'el servidor',
}

export interface SodSourceLabelOptions {
  /** Nombre del destino («Producción»); sin él va el tipo y el id. */
  targetLabel?: (scopeType: string, scopeId: number) => string | undefined
  /** Etiqueta del catálogo de una capacidad; sin ella va el id. */
  capabilityLabel?: (id: string) => string | undefined
}

function targetPhrase(source: SodSource, options: SodSourceLabelOptions): string {
  const type = source.scopeType ?? ''
  const id = source.scopeId
  const name = id !== undefined ? options.targetLabel?.(type, id) : undefined
  const typeLabel = SCOPE_TYPE_LABELS[type] ?? 'el destino'
  if (name) return `${typeLabel} ${name}`
  return id !== undefined ? `${typeLabel} #${id}` : typeLabel
}

/** Qué choca, en una frase corta: «rol owner en el entorno Producción». */
export function sodSourceLabel(source: SodSource, options: SodSourceLabelOptions = {}): string {
  switch (source.kind) {
    case 'base_role':
      return `rol base ${source.role ?? OWNER}`
    case 'scope_grant':
      return `rol ${source.role ?? OWNER} en ${targetPhrase(source, options)}`
    case 'capability_grant': {
      const id = source.capability ?? 'desconocida'
      const label = options.capabilityLabel?.(id)
      return `capacidad puntual ${label ? `«${label}» (${id})` : id} en ${targetPhrase(source, options)}`
    }
    case 'global_capability':
      return `capacidad global ${globalCapabilityLabel(source.globalCapability ?? ACCESS_ADMIN)}`
    default:
      return source.kind
  }
}

/**
 * El rechazo del servidor (o el aviso previo) en un párrafo, para un toast o un mensaje de
 * formulario: la regla, qué choca y las dos salidas.
 */
export function sodConflictMessage(
  conflicts: readonly SodConflict[] | undefined,
  options: SodSourceLabelOptions = {},
): string {
  const detail = (conflicts ?? [])
    .map(
      (conflict) =>
        `${sodRulePair(conflict.rule)} (${conflict.sources.map((source) => sodSourceLabel(source, options)).join(', ')})`,
    )
    .join('; ')
  return `${SOD_RULE_EXPLANATION}${detail ? ` Choca: ${detail}.` : ''} Repartí las funciones en cuentas distintas o, si es una emergencia, declará una excepción con motivo.`
}

/** 422 `access.sod_override_invalid`, con los límites que mandó el servidor si vinieron. */
export function sodOverrideInvalidMessage(limits: {
  reasonMinLength?: number
  maxHours?: number
}): string {
  const min = limits.reasonMinLength ?? 20
  const hours = limits.maxHours ?? 168
  return `La excepción de emergencia no es válida: el motivo necesita al menos ${min} caracteres y la duración va de 1 a ${hours} horas.`
}

/** Fecha UTC sin zona del backend, en hora local. Sin `parseUtcInstant` el navegador la leería local. */
export function formatSodInstant(value: string | null | undefined): string {
  const ms = parseUtcInstant(value)
  return ms === null ? '—' : formatDateTime(new Date(ms).toISOString())
}

// ── Avisos de la propia sesión (`/auth/me.sod_warnings`) ───────────────────────

export interface SodWarningCopy {
  tone: 'warning' | 'danger'
  title: string
  body: string
}

/**
 * Qué decirle a la persona de la sesión sobre una regla que su cuenta viola. Un `status` que esta
 * versión no conoce cae a un aviso genérico en vez de callarse.
 */
export function sodWarningCopy(warning: SodWarning): SodWarningCopy {
  const pair = sodRulePair(warning.rule)
  switch (warning.status) {
    case 'grandfathered':
      return {
        tone: 'warning',
        title: 'Tu cuenta combina funciones que deberían estar separadas',
        body: `Tu cuenta combina funciones que deberían estar separadas (${pair}). Es una combinación heredada de antes de la regla y por ahora sigue funcionando. Pedí que se separen en cuentas distintas.`,
      }
    case 'override': {
      const expires = warning.expires_at ? ` hasta el ${formatSodInstant(warning.expires_at)}` : ''
      const reason = warning.reason ? ` Motivo declarado: «${warning.reason}».` : ''
      return {
        tone: 'warning',
        title: 'Tu cuenta tiene una excepción de emergencia',
        body: `Tu cuenta combina ${pair} por una excepción de emergencia que rige${expires}. Cuando venza, se desactivan tus funciones de oficial de seguridad.${reason} Pedí que se separen antes de que venza.`,
      }
    }
    case 'neutralized':
      return {
        tone: 'danger',
        title: 'Tus funciones de oficial de seguridad están desactivadas',
        body: `Tu cuenta combina ${pair} sin ninguna excepción vigente, así que el servidor descartó lo que te da oficial de seguridad: administrar servidores, catálogos, entornos y el cifrado. El resto de tu acceso sigue igual. Pedí que se separen las funciones en cuentas distintas.`,
      }
    default:
      return {
        tone: 'warning',
        title: 'Tu cuenta combina funciones que deberían estar separadas',
        body: `Tu cuenta combina funciones que deberían estar separadas (${pair}). Pedí que se separen.`,
      }
  }
}
