import { fetchPage, type QueryParams } from '@/lib/api/client'
import { environmentOutSchema, type EnvironmentOut, type Page } from '@/lib/contracts'

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
