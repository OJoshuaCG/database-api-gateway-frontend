import { fetchBlob, fetchData, fetchPage, mutateData, type QueryParams } from '@/lib/api/client'
import {
  adoptComparisonOutSchema,
  executeComparisonOutSchema,
  executePreviewOutSchema,
  resolveComparisonSelectionOutSchema,
  schemaComparisonItemOutSchema,
  schemaComparisonSummaryOutSchema,
  type AdoptComparisonIn,
  type AdoptComparisonOut,
  type CreateSchemaComparisonIn,
  type ExecuteComparisonIn,
  type ExecuteComparisonOut,
  type ExecutePreviewIn,
  type ExecutePreviewOut,
  type Page,
  type ResolveComparisonSelectionIn,
  type ResolveComparisonSelectionOut,
  type SchemaChangeType,
  type SchemaComparisonItemOut,
  type SchemaComparisonSummaryOut,
  type SchemaObjectType,
} from '@/lib/contracts'
import { PAGINATION } from '@/lib/contracts'

const BASE = '/schema-comparisons'
const base = (id: number) => `${BASE}/${id}`

/** `POST /schema-comparisons` 🔌 — fotografía ambos motores, corre el diff y persiste el resumen. */
export function createSchemaComparison(
  body: CreateSchemaComparisonIn,
): Promise<SchemaComparisonSummaryOut> {
  return mutateData('POST', BASE, schemaComparisonSummaryOutSchema, { body })
}

/** `GET /schema-comparisons/{id}` — resumen ya calculado (no vuelve a tocar el motor). */
export function getSchemaComparison(
  id: number,
  signal?: AbortSignal,
): Promise<SchemaComparisonSummaryOut> {
  return fetchData(base(id), schemaComparisonSummaryOutSchema, { signal })
}

/** `GET /schema-comparisons/{id}/items` — ítems del diff con el DDL exacto, paginado. */
export function listSchemaComparisonItems(
  id: number,
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<SchemaComparisonItemOut>> {
  return fetchPage(`${base(id)}/items`, schemaComparisonItemOutSchema, { query: params, signal })
}

/** Tope de seguridad para `fetchAllSchemaComparisonItems`: nunca pagina más allá de esto. */
export const FETCH_ALL_ITEMS_MAX_PAGES = 40

/**
 * Pagina `GET .../items` hasta agotar `has_next` (usado por las vistas de selección, que
 * necesitan el conjunto COMPLETO filtrado en memoria para que los atajos "todo"/"solo aditivos
 * seguros" operen sobre todos los ítems, no solo la página visible). Se corta en
 * `FETCH_ALL_ITEMS_MAX_PAGES` páginas como salvaguarda ante un diff anormalmente grande.
 */
export async function fetchAllSchemaComparisonItems(
  id: number,
  filters: QueryParams,
  signal?: AbortSignal,
): Promise<{ items: SchemaComparisonItemOut[]; truncated: boolean }> {
  const items: SchemaComparisonItemOut[] = []
  let page = 1
  let truncated = false
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await listSchemaComparisonItems(
      id,
      { ...filters, page, size: PAGINATION.maxSize },
      signal,
    )
    items.push(...result.items)
    if (!result.pagination.has_next) break
    if (page >= FETCH_ALL_ITEMS_MAX_PAGES) {
      truncated = true
      break
    }
    page += 1
  }
  return { items, truncated }
}

/**
 * `POST .../execute-preview` — solo lectura, sin rate limit: resuelve el conjunto exacto de
 * sentencias para un `mode`/selección y devuelve el `confirm_token` a reenviar tal cual en
 * `execute`. Se consume vía `useQuery` (no es una mutación real): es idempotente y cacheable.
 */
export function previewExecuteComparison(
  id: number,
  body: ExecutePreviewIn,
  signal?: AbortSignal,
): Promise<ExecutePreviewOut> {
  return mutateData('POST', `${base(id)}/execute-preview`, executePreviewOutSchema, {
    body,
    signal,
  })
}

/**
 * `POST .../resolve-selection` (§10.6) — SOLO LECTURA: cierra las dependencias de una selección
 * propuesta sin adoptar ni ejecutar nada. Igual que `execute-preview`, se consume vía `useQuery`
 * (idempotente y cacheable por conjunto de selección). ⚠ NO valida expiración: nunca usarlo como
 * sustituto de refrescar la comparación.
 */
export function resolveComparisonSelection(
  id: number,
  body: ResolveComparisonSelectionIn,
  signal?: AbortSignal,
): Promise<ResolveComparisonSelectionOut> {
  return mutateData('POST', `${base(id)}/resolve-selection`, resolveComparisonSelectionOutSchema, {
    body,
    signal,
  })
}

/** `POST .../adopt` 🔌 (Opción A, rate limit 3/min) — adopta el diff como versión del blueprint. */
export function adoptComparison(id: number, body: AdoptComparisonIn): Promise<AdoptComparisonOut> {
  return mutateData('POST', `${base(id)}/adopt`, adoptComparisonOutSchema, { body })
}

/**
 * `POST .../execute` 🔌 (Opción B, rate limit 3/min) — ejecuta el diff directo sobre el target.
 * `force` viaja como query param (override de cuarentena), igual que `applyMigrations`.
 */
export function executeComparison(
  id: number,
  body: ExecuteComparisonIn,
  force: boolean,
): Promise<ExecuteComparisonOut> {
  return mutateData('POST', `${base(id)}/execute`, executeComparisonOutSchema, {
    body,
    query: { force },
  })
}

export interface ExportSchemaComparisonSqlParams {
  /** Mismos `id` de `GET .../items`; omitido o vacío = exporta todo el diff. */
  itemIds?: number[]
  /** Anexa el `down_sql` sugerido (orden inverso) comentado al final del archivo. */
  includeRollback?: boolean
  /** Mismos filtros de `GET .../items` (§10.6), combinables con `itemIds`. */
  objectType?: SchemaObjectType | null
  changeType?: SchemaChangeType | null
}

/**
 * `GET .../export` — descarga de solo lectura, NO devuelve el envelope `ApiResponse`: el
 * cuerpo es texto `.sql` plano (`Content-Type: application/sql`), por eso usa `fetchBlob` en
 * vez de `fetchData`. No toca el motor, no valida fingerprint, no requiere `confirm_token`.
 */
export function exportSchemaComparisonSql(
  id: number,
  params: ExportSchemaComparisonSqlParams,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  return fetchBlob(`${base(id)}/export`, {
    query: {
      item_ids: params.itemIds?.length ? params.itemIds : undefined,
      include_rollback: params.includeRollback || undefined,
      object_type: params.objectType ?? undefined,
      change_type: params.changeType ?? undefined,
    },
    signal,
  })
}
