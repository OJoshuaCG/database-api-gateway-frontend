import { fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  environmentOutSchema,
  type EnvironmentOut,
  type EnvironmentUpdate,
  type Page,
} from '@/lib/contracts'

const BASE = '/environments'

/**
 * `GET /environments` — **PAGINADO**.
 *
 * Ojo con el molde: la estructura de archivos de este módulo se calca de `permission-profiles`,
 * pero ese endpoint NO pagina y usa `fetchList`. Este devuelve un envelope con bloque
 * `pagination`, así que copiar el `fetchList` de allá rompe.
 *
 * No se expone filtro `only_active`: el catálogo se trae COMPLETO y el subconjunto activo se
 * deriva en cliente. Ver `useEnvironmentOptions` para el motivo (el join tiene que resolver
 * también los entornos desactivados).
 */
export function listEnvironments(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<EnvironmentOut>> {
  return fetchPage(BASE, environmentOutSchema, { query: params, signal })
}

/**
 * `PATCH /environments/{id}` — hoy solo la puerta de agentes (`allows_agent_access`).
 *
 * `confirmSlug` va como **query param**, no en el body, y solo hace falta al ENCENDER
 * (`false → true`): sin él el backend responde 422 `environment.confirmation_required`. Apagar no
 * lo pide. Pide `environments.write` (global, solo security_officer) + step-up.
 */
export function updateEnvironment(
  id: number,
  body: EnvironmentUpdate,
  confirmSlug?: string,
): Promise<EnvironmentOut> {
  return mutateData('PATCH', `${BASE}/${id}`, environmentOutSchema, {
    body,
    query: { confirm_slug: confirmSlug },
  })
}
