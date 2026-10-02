import { ownerOnlyCapabilityIds } from '@/features/auth'
import type { AccessElevation, CapabilityDescriptor } from '@/lib/contracts'

/**
 * Espejo de la política de ASIGNACIÓN del backend (C3, api-reference-v29 §9): qué cambios de
 * acceso son una ELEVACIÓN que pide un segundo `access_admin`.
 *
 * Reemplaza a `grant-ceiling.ts`, que copiaba el viejo techo por tenencia («nadie otorga más de
 * lo que tiene») y ESCONDÍA lo que el actor no tenía. Ese techo se retiró: obligaba a que quien
 * administra accesos tuviera cada deber que reparte, justo la combinación que la separación de
 * deberes deshace. Ahora `access_admin` asigna cualquier rol, global o capacidad otorgable
 * (`ASSIGNABLE_BY`), así que la UI ofrece todo y, en vez de bloquear, MARCA lo que va a quedar
 * pendiente de otra persona.
 *
 * Fuente: `app/services/capability_catalog.py` (`needs_second_approver`, `is_sensitive`) y
 * `app/core/assignment_policy.py` (`split`). Es una PISTA: decide el servidor, y un `202
 * access.elevation_pending` manda sobre lo que diga esto.
 */

const OWNER = 'owner'

/**
 * `is_sensitive`: ¿una capacidad puntual exige segundo aprobador? Si es otorgable y EXCLUSIVA de
 * `owner` (la tiene `owner` y no `operator`). Desde C3 son 11: las 8 de antes más
 * `blueprints.apply`, `schema_diff.execute` y `collation.execute`, que sin el techo las otorgaba un
 * solo administrador. Se deriva del catálogo y no de una lista: sin catálogo, nada es sensible y
 * el servidor lo dice al responder `pending`.
 */
export function isSensitiveCapability(
  capability: string,
  catalog: readonly CapabilityDescriptor[] | undefined,
): boolean {
  if (!catalog) return false
  const row = catalog.find((entry) => entry.id === capability)
  if (!row?.grantable) return false
  return ownerOnlyCapabilityIds(catalog).includes(capability)
}

export interface SecondApproverInput {
  /** Rol base o por alcance que se asigna. */
  role?: string | null
  /** Capacidad global que se AGREGA. */
  globalCapability?: string | null
  /** Capacidad puntual que se otorga. */
  capability?: string | null
}

/**
 * `needs_second_approver`: lo exclusivo de `owner`, en cualquiera de sus formas.
 *
 * - el rol `owner` (base o por alcance);
 * - CUALQUIER capacidad global (`access_admin`, `security_officer`): son funciones, no niveles;
 * - una capacidad puntual sensible (`isSensitiveCapability`).
 *
 * `operator` no: es el trabajo diario. Las bajas nunca son elevación; eso lo resuelve quien llama
 * comparando contra el estado actual (`accessElevations`).
 */
export function needsSecondApprover(
  input: SecondApproverInput,
  catalog?: readonly CapabilityDescriptor[],
): boolean {
  if (input.role === OWNER) return true
  if (input.globalCapability) return true
  if (input.capability && isSensitiveCapability(input.capability, catalog)) return true
  return false
}

/** El acceso de una cuenta, con lo único que la partición mira. */
export interface AccessStateInput {
  baseRole: string
  globalCapabilities: readonly string[]
  scopeGrants: readonly { scope_type: string; scope_id: number; role: string }[]
}

/**
 * `split(actual, deseado)` del backend, solo la lista de elevaciones (lo que quedaría PENDIENTE al
 * guardar). Mismo orden y misma forma `kind` que publica el `202`:
 *
 * - rol base: `owner` desde algo que no era `owner`;
 * - globales: las que se AGREGAN (las que se quitan se quitan ya);
 * - alcances: un `owner` nuevo en un alcance, o un alcance que pasa a `owner`.
 *
 * Vacía ⇒ el cambio entero se aplicaría en el acto.
 */
export function accessElevations(
  actual: AccessStateInput,
  desired: AccessStateInput,
): AccessElevation[] {
  const elevations: AccessElevation[] = []

  if (
    desired.baseRole !== actual.baseRole &&
    needsSecondApprover({ role: desired.baseRole }) &&
    actual.baseRole !== OWNER
  ) {
    elevations.push({ kind: 'base_role', role: desired.baseRole })
  }

  const current = new Set(actual.globalCapabilities)
  for (const global of [...new Set(desired.globalCapabilities)].sort()) {
    if (!current.has(global) && needsSecondApprover({ globalCapability: global })) {
      elevations.push({ kind: 'global_capability', global_capability: global })
    }
  }

  const previous = new Map(
    actual.scopeGrants.map((grant) => [`${grant.scope_type}:${grant.scope_id}`, grant.role]),
  )
  const sorted = [...desired.scopeGrants].sort((a, b) =>
    a.scope_type === b.scope_type
      ? a.scope_id - b.scope_id || a.role.localeCompare(b.role)
      : a.scope_type.localeCompare(b.scope_type),
  )
  for (const grant of sorted) {
    const before = previous.get(`${grant.scope_type}:${grant.scope_id}`)
    if (needsSecondApprover({ role: grant.role }) && before !== grant.role) {
      elevations.push({
        kind: 'scope_grant',
        scope_type: grant.scope_type,
        scope_id: grant.scope_id,
        role: grant.role,
      })
    }
  }

  return elevations
}

/** Lo que dice el distintivo junto a una opción que eleva. Un solo texto en toda la UI. */
export const SECOND_APPROVER_LABEL = 'Requiere segundo aprobador'
