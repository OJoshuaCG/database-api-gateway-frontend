import { useId } from 'react'
import type { Capability, CapabilityDescriptor } from '@/lib/contracts'
import { useEnvironmentOptions } from '@/features/environments/hooks/use-environment-options'
import { capabilitiesAt, type AccessTarget } from '../authz-model'
import { useCapabilities, useCapabilityCatalog } from './use-capabilities'

export interface CapabilityGuard {
  /** `false` = el control tiene que ir deshabilitado (o escondido, si se repite en filas). */
  allowed: boolean
  /** Texto VISIBLE junto al control cuando está deshabilitado; `undefined` cuando está permitido. */
  hint: string | undefined
  /** `id` para el `<p>` del motivo: el control lo referencia con `aria-describedby`. */
  hintId: string
  /** Para `aria-describedby` del control: el `hintId` solo cuando hay motivo que leer. */
  describedBy: string | undefined
  /** Las que faltan, en el orden pedido. */
  missing: Capability[]
  /**
   * Con destino: la capa 2 todavía no se pudo resolver (`pending`: falta el catálogo o los
   * entornos; `failed`: no llegaron). Mientras tanto la guarda falla cerrado, y el motivo no es
   * «no tenés» sino «no se sabe todavía». `null` cuando se resolvió o no hay destino.
   */
  unresolved: 'pending' | 'failed' | null
}

export interface CapabilityGuardOptions {
  /**
   * El destino concreto, para resolver el rol por alcance con la misma regla que
   * `app/core/scope.py`. Cambia algo en toda capacidad de capa 2 (`layer2CapabilityIds`): todas
   * las rutas con destino hacen `require_at`. Pasalo cuando la pantalla CONOCE el destino
   * (una base gestionada: servidor + entorno). Con una lectura o una capacidad global no cambia
   * nada, y sin destino conocido —un alta cuyo entorno se elige después— no se pasa.
   */
  scope?: AccessTarget
}

/** «Etiqueta del catálogo», id — o solo el id si el catálogo no la trae. */
export function capabilityName(id: string, catalog?: readonly CapabilityDescriptor[]): string {
  const label = catalog?.find((row) => row.id === id)?.label
  return label ? `«${label}», ${id}` : id
}

/**
 * Motivo visible de un control deshabilitado por capacidad. Nombra la capacidad que falta: el 403
 * la oculta para no dar un mapa de la superficie, pero `/auth/me` ya le publica al usuario sus
 * propias capacidades, así que nombrarla acá no revela nada y le da algo concreto que pedir.
 */
export function capabilityHint(
  action: string,
  missing: readonly string[],
  catalog?: readonly CapabilityDescriptor[],
): string {
  const named = missing.map((id) => capabilityName(id, catalog)).join(' y ')
  const base = `Tu acceso no permite ${action} (requiere ${named}). Pedíselo a quien administra los accesos.`
  const note = grantableNote(missing, catalog)
  return note ? `${base} ${note}` : base
}

/**
 * «Se puede otorgar sola»: cuando TODO lo que falta es otorgable como capacidad puntual
 * (`grantable` del catálogo). Le dice a quien la pide que no hace falta subirle el rol —que
 * arrastraría todo lo demás del rol— sino otorgarle esa capacidad suelta (`capability-grants.md`).
 * Sin catálogo, o con una que no es otorgable, no dice nada: prometerlo sería inventar.
 */
export function grantableNote(
  missing: readonly string[],
  catalog?: readonly CapabilityDescriptor[],
): string | undefined {
  const unique = [...new Set(missing)]
  if (!catalog || unique.length === 0) return undefined
  const grantable = unique.every((id) => catalog.find((row) => row.id === id)?.grantable === true)
  if (!grantable) return undefined
  return unique.length === 1
    ? 'Se puede otorgar sola, como capacidad puntual, sin cambiar tu rol.'
    : 'Se pueden otorgar solas, como capacidades puntuales, sin cambiar tu rol.'
}

/**
 * Guarda de UI: ¿el usuario puede hacer esto? Si no, por qué, en una frase visible.
 *
 * ⚠️ Es una PISTA, no autorización: decide el servidor, siempre. La pantalla igual tiene que
 * manejar el 403. Cuando el backend no publica capacidades, `can` falla ABIERTO y esto no
 * deshabilita nada (ver `useCapabilities`).
 *
 * Patrones de uso (docs/maintenance.md, «Capacidades y 403»): una acción única en contexto va
 * deshabilitada con `hint` al lado; una acción repetida en filas se esconde y se explica UNA vez
 * con un `Callout` sobre la tabla.
 */
export function useCapabilityGuard(
  required: Capability | readonly Capability[],
  /** Qué acción describe, en infinitivo y en minúscula: «aplicar versiones». */
  action: string,
  options: CapabilityGuardOptions = {},
): CapabilityGuard {
  const { can, known, baseRole, role, scopeRoles, globalCapabilities, catalogVersion } =
    useCapabilities()
  const catalog = useCapabilityCatalog()
  const hintId = useId()
  /*
   * La capa 2 se resuelve solo con un backend que tiene el modelo de capacidades (publica
   * `catalog_version`) y una sesión con permisos por alcance: sin permisos, el rol del destino es
   * el base, que ya es el de la capa 1.
   */
  const scoped =
    options.scope !== undefined && known && catalogVersion !== null && scopeRoles.length > 0
  // Los entornos solo hacen falta para resolver «sin clasificar = el más protegido». Sin servidor
  // ni entorno el destino es global y rige el base: no hay nada que resolver.
  const needsEnvironments =
    scoped && options.scope?.environmentId === null && options.scope.serverId !== null
  const environments = useEnvironmentOptions(needsEnvironments)

  const list: readonly Capability[] = typeof required === 'string' ? [required] : required
  const base = baseRole ?? role
  let atScope: Set<string> | null = null
  /*
   * Con destino, la capa 2 falla CERRADO: si falta el catálogo, el rol o —para una base sin
   * clasificar— los entornos, no se sabe qué rige ahí y la pista no puede prometer un permiso que
   * el servidor quizá niegue en una operación que toca el motor. Solo el backend viejo (sin
   * `catalog_version`) falla abierto, y eso ya lo resolvió `scoped`.
   */
  let unresolved: 'pending' | 'failed' | null = null
  if (scoped && options.scope) {
    if (!catalog.data || !base) {
      unresolved = catalog.isError || !base ? 'failed' : 'pending'
    } else if (needsEnvironments && !environments.data) {
      unresolved = environments.isError ? 'failed' : 'pending'
    } else {
      atScope = new Set(
        capabilitiesAt(
          {
            catalog: catalog.data,
            baseRole: base,
            globalCapabilities,
            grants: scopeRoles.map((grant) => ({
              scopeType: grant.scope_type,
              scopeId: grant.scope_id,
              role: grant.role,
            })),
          },
          options.scope,
          environments.data ?? [],
        ),
      )
    }
  }
  const missing = list.filter(
    (capability) =>
      !can(capability) || unresolved !== null || (atScope !== null && !atScope.has(capability)),
  )
  const allowed = missing.length === 0
  let hint: string | undefined
  if (!allowed) {
    const layer1Missing = list.filter((capability) => !can(capability))
    hint =
      unresolved !== null && layer1Missing.length === 0
        ? unresolvedHint(action, unresolved)
        : capabilityHint(action, missing, catalog.data)
  }
  return {
    allowed,
    hint,
    hintId,
    describedBy: allowed ? undefined : hintId,
    missing,
    unresolved: allowed ? null : unresolved,
  }
}

/** Motivo mientras la capa 2 no se puede resolver: no es «no tenés», es «todavía no sé». */
function unresolvedHint(action: string, state: 'pending' | 'failed'): string {
  return state === 'pending'
    ? `Comprobando si tu acceso permite ${action} en este destino…`
    : `No se pudo comprobar si tu acceso permite ${action} en este destino. Recargá la página para volver a intentarlo.`
}
