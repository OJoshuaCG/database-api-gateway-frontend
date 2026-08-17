import {
  fetchBlob,
  fetchData,
  fetchPage,
  fetchText,
  mutateData,
  type QueryParams,
} from '@/lib/api/client'
import {
  exportCapabilitiesSchema,
  exportItemSchema,
  exportManifestSchema,
  exportObjectCatalogSchema,
  exportPreviewSchema,
  exportResolvedSelectionSchema,
  exportSummarySchema,
  type ExportArtifactDelivery,
  type ExportCapabilities,
  type ExportDataSelection,
  type ExportItem,
  type ExportManifest,
  type ExportObjectCatalog,
  type ExportPreview,
  type ExportResolvedSelection,
  type ExportSelection,
  type ExportSpec,
  type ExportSummary,
  type Page,
} from '@/lib/contracts'

const BASE = '/database-exports'
const base = (id: number) => `${BASE}/${id}`

/**
 * Rutas que cuelgan de un servidor + una base. El `encodeURIComponent` NO es decorativo: el nombre
 * de la base sale del catálogo del motor, no de un formulario nuestro, y puede traer caracteres que
 * de otro modo romperían la ruta (o la reescribirían).
 */
const scoped = (serverId: number, database: string) =>
  `/servers/${serverId}/databases/${encodeURIComponent(database)}`

// ── Cuerpos de petición ──────────────────────────────────────────────────────────
/**
 * Cuerpo de crear plan y del `spec` de `preview`. Es un `Partial` del `ExportSpec` porque todos los
 * bloques tienen default en el backend (`{}` es un cuerpo válido) y el wizard omite a propósito los
 * que no aplican al formato elegido — mandar `csv` en una exportación `sql` sería ruido con riesgo
 * de disparar una regla de la matriz de compatibilidad que el usuario nunca tocó.
 */
export type ExportSpecPayload = Partial<ExportSpec>

/** Cuerpo de `POST .../resolve-selection`: las dos selecciones, sin congelar nada. */
export interface ExportResolveSelectionIn {
  selection?: ExportSelection
  data?: ExportDataSelection
  /**
   * `true` = el backend agrega las dependencias que falten y las devuelve en `added`. Con `false`
   * (el default), una selección explícita a la que le falta una dependencia da 422
   * `export.missing_dependencies` en vez de recortarse en silencio.
   */
  auto_resolve_dependencies?: boolean
}

/** Cuerpo de `POST .../preview`. */
export interface ExportPreviewIn {
  spec?: ExportSpecPayload
  auto_resolve_dependencies?: boolean
  /**
   * `true` = valida y reporta SIN congelar la selección ni emitir `confirm_token`. Es el modo del
   * panel vivo de consecuencias; el preview "de verdad" (con token) se pide una sola vez, cuando el
   * usuario confirma.
   */
  dry_run_only?: boolean
  include_sample?: boolean
}

/** Cuerpo de `POST .../execute`: doble factor — el nombre re-tecleado + el token del preview. */
export interface ExportExecuteIn {
  confirm_target_name: string
  confirm_token: string
}

// ── Capacidades y plan ───────────────────────────────────────────────────────────
/**
 * `GET /servers/{sid}/databases/{db}/export-capabilities` 🔌 (30/min) — la ÚNICA fuente del
 * formulario: controles, valores válidos, defaults, matriz de combinaciones prohibidas, dialecto
 * csv, empaquetado y límites. Se llama primero y todo lo demás se deriva de acá.
 */
export function getExportCapabilities(
  serverId: number,
  database: string,
  signal?: AbortSignal,
): Promise<ExportCapabilities> {
  return fetchData(`${scoped(serverId, database)}/export-capabilities`, exportCapabilitiesSchema, {
    signal,
  })
}

/**
 * `POST /servers/{sid}/databases/{db}/database-exports` 🔌 (10/min) — persiste el plan `pending`
 * (201). El cuerpo ES el `ExportSpec`: el servidor y la base viajan en la ruta, no en el body.
 */
export function createDatabaseExport(
  serverId: number,
  database: string,
  body: ExportSpecPayload,
): Promise<ExportSummary> {
  return mutateData('POST', `${scoped(serverId, database)}/database-exports`, exportSummarySchema, {
    body,
  })
}

/**
 * `GET .../objects` 🔌 (10/min) — catálogo en vivo del motor para el selector de objetos. Acepta
 * `page`, `size`, `object_type` y `name_like`.
 *
 * Usa `fetchData` y NO `fetchPage` a propósito: la paginación de este endpoint viaja DENTRO del
 * objeto (`total`/`page`/`size`), junto a metadatos de catálogo (`counts_by_type`,
 * `excluded_internal`) que el envelope paginado estándar no transporta.
 */
export function getExportObjects(
  id: number,
  params: QueryParams,
  signal?: AbortSignal,
): Promise<ExportObjectCatalog> {
  return fetchData(`${base(id)}/objects`, exportObjectCatalogSchema, { query: params, signal })
}

/**
 * `POST .../resolve-selection` 🔌 (10/min) — resuelve las dos selecciones y el cierre de
 * dependencias sin congelar el plan: lo agregado vuelve en `added` y lo podado en
 * `excluded_by_dependency`.
 */
export function resolveExportSelection(
  id: number,
  body: ExportResolveSelectionIn,
  signal?: AbortSignal,
): Promise<ExportResolvedSelection> {
  return mutateData('POST', `${base(id)}/resolve-selection`, exportResolvedSelectionSchema, {
    body,
    signal,
  })
}

/**
 * `POST .../preview` 🔌 (10/min) — valida el spec entero y devuelve el plan objeto por objeto. Con
 * `dry_run_only: false` además CONGELA la selección y emite el `confirm_token`, y cada llamada
 * reemplaza el token anterior.
 */
export function previewDatabaseExport(
  id: number,
  body: ExportPreviewIn,
  signal?: AbortSignal,
): Promise<ExportPreview> {
  return mutateData('POST', `${base(id)}/preview`, exportPreviewSchema, { body, signal })
}

/**
 * `POST .../execute` 🔌 (3/min) — valida y ENCOLA el job asíncrono (no exporta en la request). El
 * avance se sigue por polling de `GET /{id}`.
 */
export function executeDatabaseExport(id: number, body: ExportExecuteIn): Promise<ExportSummary> {
  return mutateData('POST', `${base(id)}/execute`, exportSummarySchema, { body })
}

// ── Seguimiento del job ──────────────────────────────────────────────────────────
/**
 * `GET /database-exports/{id}` (sin rate limit, a propósito) — resumen + estado del job: el latido
 * del polling cada 2–3 s mientras `status` es `pending` o `running`.
 */
export function getDatabaseExport(id: number, signal?: AbortSignal): Promise<ExportSummary> {
  return fetchData(base(id), exportSummarySchema, { signal })
}

/**
 * `GET .../items` (sin rate limit) — reporte por objeto, paginado con el envelope ESTÁNDAR y
 * ordenado por `seq`. Los ítems se escriben de una sola vez al terminar el job: durante
 * `pending`/`running` esto devuelve lista vacía.
 */
export function listExportItems(
  id: number,
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<ExportItem>> {
  return fetchPage(`${base(id)}/items`, exportItemSchema, { query: params, signal })
}

/** `POST .../cancel` (sin rate limit) — cancelación cooperativa: el worker corta en el próximo punto seguro. */
export function cancelDatabaseExport(id: number): Promise<ExportSummary> {
  return mutateData('POST', `${base(id)}/cancel`, exportSummarySchema, { body: {} })
}

/**
 * `GET .../manifest` (sin rate limit) — inventario verificable del artefacto SIN abrirlo.
 * Sobrevive a `consumed` y a `purged`, así que «¿qué me llevé?» se sigue pudiendo responder
 * después de descargar.
 */
export function getExportManifest(id: number, signal?: AbortSignal): Promise<ExportManifest> {
  return fetchData(`${base(id)}/manifest`, exportManifestSchema, { signal })
}

// ── Entrega del artefacto ────────────────────────────────────────────────────────
/**
 * Traduce las cabeceras de una entrega (`download`/`content`) a `ExportArtifactDelivery`. Estos
 * metadatos no tienen otra vía de llegada: el cuerpo es el artefacto crudo, sin envelope.
 */
function readArtifactDelivery(headers: Headers): ExportArtifactDelivery {
  // El sha256 viaja duplicado en el `ETag` (entre comillas, por la sintaxis HTTP del validador).
  const etag = headers.get('ETag')
  const sha256 = headers.get('X-Export-Sha256') ?? etag?.replace(/"/g, '') ?? null

  // Tres estados, no dos: ausente es DESCONOCIDO. Un `=== 'true'` a secas convertiría una cabecera
  // que no vino en «artefacto parcial», que es exactamente la banda roja falsa que no queremos.
  const completeHeader = headers.get('X-Export-Complete')
  const complete = completeHeader === null ? null : completeHeader === 'true'

  const byteSizeHeader = headers.get('Content-Length')
  const parsedByteSize = byteSizeHeader === null ? Number.NaN : Number(byteSizeHeader)
  const byteSize = Number.isFinite(parsedByteSize) ? parsedByteSize : null

  return { sha256, complete, byteSize }
}

/**
 * `GET .../download` (3/min) — descarga del artefacto. NO devuelve el envelope `ApiResponse`: el
 * cuerpo es el archivo crudo (de ahí `fetchBlob`) y los metadatos viajan en cabeceras.
 *
 * ⚠️ Es de **un solo uso**: al completarse la descarga el artefacto pasa a `consumed` y un segundo
 * intento responde 410. Y **cada descarga queda auditada**, así que no se reintenta "por si acaso"
 * ni se dispara desde un efecto — solo desde una acción explícita del operador.
 */
export async function downloadExportArtifact(
  id: number,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string; delivery: ExportArtifactDelivery }> {
  // El fallback es genérico a propósito: el artefacto puede ser sql, csv, json, ndjson, gzip o zip, y
  // el default de `fetchBlob` (`export.sql`) le pondría a un `.zip` una extensión que miente. Solo se
  // usa si `Content-Disposition` no llegó (p. ej. cross-origin sin `Access-Control-Expose-Headers`).
  const { blob, filename, headers } = await fetchBlob(`${base(id)}/download`, {
    signal,
    fallbackFilename: `export-${id}`,
  })
  return { blob, filename, delivery: readArtifactDelivery(headers) }
}

/**
 * `GET .../content` (3/min) — el artefacto como texto plano, para el portapapeles. Mismas
 * condiciones que `download`: un solo uso (después, 410) y cada lectura queda auditada. Solo es
 * viable cuando el preview marcó `inline_delivery_viable`.
 */
export async function getExportContent(
  id: number,
  signal?: AbortSignal,
): Promise<{ text: string; delivery: ExportArtifactDelivery }> {
  const { text, headers } = await fetchText(`${base(id)}/content`, { signal })
  return { text, delivery: readArtifactDelivery(headers) }
}
