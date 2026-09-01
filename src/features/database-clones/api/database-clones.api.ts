import { fetchData, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  cloneClosureOutSchema,
  cloneInventoryOutSchema,
  cloneItemOutSchema,
  cloneListItemOutSchema,
  clonePreviewOutSchema,
  cloneSummaryOutSchema,
  type CloneClosureOut,
  type CloneCreateIn,
  type CloneExecuteIn,
  type CloneInventoryOut,
  type CloneItemOut,
  type CloneListItemOut,
  type ClonePreviewIn,
  type ClonePreviewOut,
  type CloneResolveSelectionIn,
  type CloneSummaryOut,
  type Page,
} from '@/lib/contracts'

const BASE = '/database-clones'
const base = (id: number) => `${BASE}/${id}`

/** `POST /database-clones` 🔌 (10/min) — fotografía el origen y persiste el plan `pending`. */
export function createDatabaseClone(body: CloneCreateIn): Promise<CloneSummaryOut> {
  return mutateData('POST', BASE, cloneSummaryOutSchema, { body })
}

/**
 * `GET /database-clones` — historial paginado, del más nuevo al más viejo.
 *
 * Es el punto de reentrada del módulo: sin este listado, un clon cuyo id se perdió del estado
 * del navegador quedaba inalcanzable. Sin rate limit (lee la BD del gateway, no un motor).
 */
export function listDatabaseClones(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<CloneListItemOut>> {
  return fetchPage(BASE, cloneListItemOutSchema, { query: params, signal })
}

/** `GET /database-clones/{id}` — resumen + estado del job (latido del polling). */
export function getDatabaseClone(id: number, signal?: AbortSignal): Promise<CloneSummaryOut> {
  return fetchData(base(id), cloneSummaryOutSchema, { signal })
}

/** `GET .../objects` 🔌 (10/min) — inventario del origen: portabilidad + grafo de dependencias. */
export function getCloneObjects(id: number, signal?: AbortSignal): Promise<CloneInventoryOut> {
  return fetchData(`${base(id)}/objects`, cloneInventoryOutSchema, { signal })
}

/**
 * `POST .../resolve-selection` 🔌 (10/min) — cierre de dependencias de una selección propuesta
 * (lo que se agrega solo por FK/trigger, y lo que solo se sugiere como advisory).
 */
export function resolveCloneSelection(
  id: number,
  body: CloneResolveSelectionIn,
  signal?: AbortSignal,
): Promise<CloneClosureOut> {
  return mutateData('POST', `${base(id)}/resolve-selection`, cloneClosureOutSchema, { body, signal })
}

/**
 * `POST .../preview` 🔌 (10/min) — plan resuelto SIN ejecutar; si se manda `selection`, la
 * REEMPLAZA y re-persiste en el job. Devuelve el `confirm_token` autoritativo para `execute`.
 */
export function previewDatabaseClone(
  id: number,
  body: ClonePreviewIn,
  signal?: AbortSignal,
): Promise<ClonePreviewOut> {
  return mutateData('POST', `${base(id)}/preview`, clonePreviewOutSchema, { body, signal })
}

/** `POST .../execute` 🔌 (3/min) — valida y ENCOLA el job asíncrono (no ejecuta en la request). */
export function executeDatabaseClone(id: number, body: CloneExecuteIn): Promise<CloneSummaryOut> {
  return mutateData('POST', `${base(id)}/execute`, cloneSummaryOutSchema, { body })
}

/** `GET .../items` — pasos ejecutados, paginados y ordenados por `seq`. */
export function listCloneItems(
  id: number,
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<CloneItemOut>> {
  return fetchPage(`${base(id)}/items`, cloneItemOutSchema, { query: params, signal })
}

/**
 * Todos los pasos de un job, recorriendo la paginación hasta agotarla.
 *
 * Existe para el diagnóstico de rendimiento: el reparto del tiempo solo cierra con la serie
 * COMPLETA de `executed_at`, porque lo que se busca son los huecos ENTRE pasos, y un hueco
 * partido por el borde de una página no se puede calcular.
 *
 * Se llama **bajo demanda** (al apretar «Copiar diagnóstico»), nunca desde el polling del
 * monitor: son ~10 requests para un job de 460 pasos y repetirlas cada par de segundos sería
 * un costo gratis. El endpoint no tiene rate limit —lee la BD del gateway, no un motor—, así
 * que el resto de las páginas van en paralelo.
 *
 * NO se fuerza un `size` grande: `PAGINATION_MAX_SIZE` es configurable en el backend (50 por
 * defecto) y pedir más de su tope devuelve 422. Se usa el que el servidor decida y se recorre.
 */
export async function fetchAllCloneItems(
  id: number,
  signal?: AbortSignal,
): Promise<CloneItemOut[]> {
  const first = await listCloneItems(id, { page: 1 }, signal)
  const { pages } = first.pagination
  if (pages <= 1) return first.items

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => listCloneItems(id, { page: i + 2 }, signal)),
  )
  // Reordenar por `seq` y no confiar en el orden de llegada: `Promise.all` preserva el orden
  // del array, pero el backend solo garantiza el orden DENTRO de cada página.
  return [first, ...rest].flatMap((page) => page.items).sort((a, b) => a.seq - b.seq)
}

/** `POST .../cancel` — cancelación cooperativa; el worker corta en el próximo punto seguro. */
export function cancelDatabaseClone(id: number): Promise<CloneSummaryOut> {
  return mutateData('POST', `${base(id)}/cancel`, cloneSummaryOutSchema, {})
}
