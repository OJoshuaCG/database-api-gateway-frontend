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
}

export interface CapabilityGuardOptions {
  /**
   * El destino concreto, para resolver el rol por alcance con la misma regla que
   * `app/core/scope.py`. **Hoy solo cambia algo en las cuatro rutas donde el backend aplica la
   * capa 2** (borrar una base, aprovisionar, aplicar y revertir versiones); en las demás el
   * servidor mira el rol unión y pasar `scope` haría la pista más estricta que el servidor.
   */
  scope?: AccessTarget
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
  const named = missing
    .map((id) => {
      const label = catalog?.find((row) => row.id === id)?.label
      return label ? `«${label}», ${id}` : id
    })
    .join(' y ')
  return `Tu acceso no permite ${action} (requiere ${named}). Pedíselo a quien administra los accesos.`
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
  const { can, known, baseRole, role, scopeRoles, globalCapabilities } = useCapabilities()
  const catalog = useCapabilityCatalog()
  const hintId = useId()
  const scoped = options.scope !== undefined && known && scopeRoles.length > 0
  // Los entornos solo hacen falta para resolver «sin clasificar = el más protegido».
  const environments = useEnvironmentOptions(scoped)

  const list: readonly Capability[] = typeof required === 'string' ? [required] : required
  let atScope: Set<string> | null = null
  const base = baseRole ?? role
  if (scoped && options.scope && catalog.data && base) {
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
  const missing = list.filter(
    (capability) => !can(capability) || (atScope && !atScope.has(capability)),
  )
  const allowed = missing.length === 0
  return {
    allowed,
    hint: allowed ? undefined : capabilityHint(action, missing, catalog.data),
    hintId,
    describedBy: allowed ? undefined : hintId,
    missing,
  }
}
