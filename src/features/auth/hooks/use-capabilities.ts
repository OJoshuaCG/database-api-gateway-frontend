import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { Capability } from '@/lib/contracts'
import { getCapabilityCatalog, getScopeReadiness } from '../api/auth.api'
import { useSession } from './use-session'

/**
 * Capacidades efectivas del usuario (api-reference-v23 §1), para habilitar o deshabilitar
 * controles.
 *
 * ⚠️ **Esto es una PISTA DE UI, no autorización.** Quien decide es el servidor, siempre, y en cada
 * request. Ocultar un botón evita que alguien llegue hasta un 403 inútil; no impide nada. Toda
 * pantalla tiene que seguir manejando el 403 aunque el control esté escondido.
 */
export interface Capabilities {
  /** ¿Tiene esta capacidad? Ver la nota de `useCapabilities` sobre el caso «lista vacía». */
  can: (capability: Capability) => boolean
  /** ¿Todas? Para los endpoints que exigen dos, como `adopt` (§4). */
  canAll: (...capabilities: Capability[]) => boolean
  /** ¿El backend publicó capacidades? `false` = estamos operando sin la pista. */
  known: boolean
  /** Rol efectivo, o `null` si el backend no lo publica. */
  role: string | null
  /**
   * ¿Esta capacidad va a pedir reautenticación? **Se publica pero TODAVÍA NO SE EXIGE** (§1/§6):
   * sirve solo para poder avisar antes de mandar la operación. No construyas un flujo que dependa
   * de que el servidor rechace por step-up, porque hoy no lo hace.
   */
  requiresStepUp: (capability: Capability) => boolean
}

export function useCapabilities(): Capabilities {
  const { admin } = useSession()

  const granted = useMemo(() => new Set(admin?.capabilities ?? []), [admin])
  const stepUp = useMemo(() => new Set(admin?.step_up_capabilities ?? []), [admin])

  /*
   * **La lista vacía significa «no sé», no «no tiene», y por eso se falla ABIERTO.**
   *
   * Es la decisión menos obvia de este módulo, así que va el razonamiento completo. Un backend
   * anterior a v23 devuelve `/auth/me` con solo `id` y `username`: sin `capabilities`. Si tratara
   * esa ausencia como denegación, la app entera se quedaría sin un solo botón habilitado contra un
   * backend perfectamente funcional — un apagón total provocado por un campo que el contrato mismo
   * define como una PISTA.
   *
   * El razonamiento de seguridad se sostiene porque la pista no es la barrera: el servidor exige la
   * capacidad en cada request, y lo peor que produce fallar abierto es que alguien llegue hasta un
   * 403 que igual lo iba a frenar. Fallar cerrado, en cambio, rompe a quien SÍ tenía permiso.
   *
   * Con la lista presente sí se decide por ella: ahí el backend está afirmando algo.
   */
  const known = granted.size > 0

  const can = useCallback(
    (capability: Capability) => (known ? granted.has(capability) : true),
    [granted, known],
  )

  const canAll = useCallback(
    (...capabilities: Capability[]) => capabilities.every((value) => can(value)),
    [can],
  )

  const requiresStepUp = useCallback((capability: Capability) => stepUp.has(capability), [stepUp])

  return { can, canAll, known, role: admin?.role ?? null, requiresStepUp }
}

/**
 * Catálogo completo de capacidades (§2), para la pantalla de administración de accesos.
 *
 * Se cachea **contra `catalog_version`** de `/auth/me`, que es exactamente para lo que el backend
 * lo publica: son 29 filas que no se mueven entre despliegues. Cuando el sha cambia, cambia la
 * query key y la entrada vieja queda huérfana sola — no hace falta invalidar a mano.
 *
 * `enabled` espera a tener la versión: pedirlo con `null` y volver a pedirlo con el sha real
 * gastaría dos requests para el mismo dato.
 */
export function useCapabilityCatalog() {
  const { admin } = useSession()
  const version = admin?.catalog_version ?? null

  return useQuery({
    queryKey: queryKeys.authz.catalog(version),
    queryFn: ({ signal }) => getCapabilityCatalog(signal),
    enabled: version !== null,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/**
 * `GET /authz/scope-readiness` (§8) — se consulta ANTES de otorgar el primer acceso por alcance.
 *
 * No se cachea agresivamente: su respuesta cambia cada vez que alguien clasifica una base, y el
 * dato viejo acá es justamente el que hace otorgar un acceso creyendo que amplía cuando recorta.
 */
export function useScopeReadiness(enabled = true) {
  return useQuery({
    queryKey: queryKeys.authz.scopeReadiness(),
    queryFn: ({ signal }) => getScopeReadiness(signal),
    enabled,
    staleTime: 30_000,
  })
}
