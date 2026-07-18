import { fetchData, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  cloneClosureOutSchema,
  cloneInventoryOutSchema,
  cloneItemOutSchema,
  clonePreviewOutSchema,
  cloneSummaryOutSchema,
  type CloneClosureOut,
  type CloneCreateIn,
  type CloneExecuteIn,
  type CloneInventoryOut,
  type CloneItemOut,
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

/** `POST .../cancel` — cancelación cooperativa; el worker corta en el próximo punto seguro. */
export function cancelDatabaseClone(id: number): Promise<CloneSummaryOut> {
  return mutateData('POST', `${base(id)}/cancel`, cloneSummaryOutSchema, {})
}
