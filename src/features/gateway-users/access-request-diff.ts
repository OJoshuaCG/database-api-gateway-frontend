import type { AccessElevation, AccessRequest } from '@/lib/contracts'

/**
 * Diferencia entre el acceso ACTUAL de una persona y el que deja una solicitud si se aprueba (v29
 * §9). `desired` es el estado FINAL completo, no un delta, así que para mostrar qué cambia hay que
 * compararlo contra lo que la persona tiene hoy.
 *
 * Como la parte que no eleva ya se aplicó al pedirla, lo normal es que la diferencia sea EXACTAMENTE
 * la lista de `elevations`. Si aparece otra cosa (o falta una elevación), el acceso cambió desde el
 * pedido: aprobarla probablemente responda `409 access.request_stale`. Eso es `drift`, y la bandeja
 * lo avisa antes de que alguien apriete «Aprobar».
 *
 * Sin el estado actual (la consulta de la persona falló o no llegó) se muestran solo las
 * elevaciones, con el «antes» desconocido.
 */

export interface AccessStateLike {
  gateway_role: string
  global_capabilities: readonly string[]
  scope_grants: readonly { scope_type: string; scope_id: number; role: string }[]
}

export interface AccessDiffRow {
  /** Clave estable para la lista. */
  key: string
  kind: 'base_role' | 'global_capability' | 'scope_grant'
  /** Qué cambia: «Rol base», la global o el destino. */
  subject: string
  /** `null` = no lo tiene; `undefined` = no se sabe (sin estado actual). */
  before: string | null | undefined
  after: string | null
  /** ¿Es una de las elevaciones de la solicitud (lo que espera al segundo aprobador)? */
  elevated: boolean
}

export interface AccessRequestDiff {
  rows: AccessDiffRow[]
  /** El acceso actual no coincide con «desired menos las elevaciones»: probablemente vieja. */
  drift: boolean
}

type ScopeLabel = (scopeType: string, scopeId: number) => string

const scopeKey = (scopeType: string, scopeId: number) => `${scopeType}:${scopeId}`

function elevationKey(elevation: AccessElevation): string | null {
  switch (elevation.kind) {
    case 'base_role':
      return 'base_role'
    case 'global_capability':
      return elevation.global_capability ? `global:${elevation.global_capability}` : null
    case 'scope_grant':
      return elevation.scope_type && elevation.scope_id != null
        ? `scope:${scopeKey(elevation.scope_type, elevation.scope_id)}`
        : null
    default:
      return null
  }
}

export function accessRequestDiff(
  request: Pick<AccessRequest, 'desired' | 'elevations'>,
  current: AccessStateLike | null | undefined,
  scopeLabel: ScopeLabel,
): AccessRequestDiff {
  const elevated = new Set(
    request.elevations.map(elevationKey).filter((key): key is string => key !== null),
  )
  const { desired } = request

  // Sin el estado actual: solo lo que eleva, con el «antes» desconocido. No hay con qué medir drift.
  if (!current) {
    const rows: AccessDiffRow[] = request.elevations.flatMap((elevation): AccessDiffRow[] => {
      const key = elevationKey(elevation)
      if (key === null) return []
      if (elevation.kind === 'base_role') {
        return [
          {
            key,
            kind: 'base_role',
            subject: 'Rol base',
            before: undefined,
            after: elevation.role ?? desired.gateway_role,
            elevated: true,
          },
        ]
      }
      if (elevation.kind === 'global_capability') {
        return [
          {
            key,
            kind: 'global_capability',
            subject: elevation.global_capability ?? '',
            before: undefined,
            after: 'sí',
            elevated: true,
          },
        ]
      }
      return [
        {
          key,
          kind: 'scope_grant',
          subject: scopeLabel(elevation.scope_type ?? '', elevation.scope_id ?? 0),
          before: undefined,
          after: elevation.role ?? null,
          elevated: true,
        },
      ]
    })
    return { rows, drift: false }
  }

  const rows: AccessDiffRow[] = []

  if (current.gateway_role !== desired.gateway_role) {
    rows.push({
      key: 'base_role',
      kind: 'base_role',
      subject: 'Rol base',
      before: current.gateway_role,
      after: desired.gateway_role,
      elevated: elevated.has('base_role'),
    })
  }

  const before = new Set(current.global_capabilities)
  const after = new Set(desired.global_capabilities)
  for (const global of [...new Set([...before, ...after])].sort()) {
    if (before.has(global) === after.has(global)) continue
    const key = `global:${global}`
    rows.push({
      key,
      kind: 'global_capability',
      subject: global,
      before: before.has(global) ? 'sí' : null,
      after: after.has(global) ? 'sí' : null,
      elevated: elevated.has(key),
    })
  }

  const rolesBefore = new Map(
    current.scope_grants.map((grant) => [scopeKey(grant.scope_type, grant.scope_id), grant]),
  )
  const rolesAfter = new Map(
    desired.scope_grants.map((grant) => [scopeKey(grant.scope_type, grant.scope_id), grant]),
  )
  for (const scope of [...new Set([...rolesBefore.keys(), ...rolesAfter.keys()])].sort()) {
    const was = rolesBefore.get(scope)
    const will = rolesAfter.get(scope)
    if (was?.role === will?.role) continue
    const ref = (will ?? was) as { scope_type: string; scope_id: number }
    const key = `scope:${scope}`
    rows.push({
      key,
      kind: 'scope_grant',
      subject: scopeLabel(ref.scope_type, ref.scope_id),
      before: was?.role ?? null,
      after: will?.role ?? null,
      elevated: elevated.has(key),
    })
  }

  const shown = new Set(rows.map((row) => row.key))
  const drift = rows.some((row) => !row.elevated) || [...elevated].some((key) => !shown.has(key))
  return { rows, drift }
}
