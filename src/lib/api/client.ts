import { type z } from 'zod'
import {
  envelope,
  emptyEnvelopeSchema,
  listEnvelope,
  paginatedEnvelope,
  type Page,
} from '@/lib/contracts/common'
import { networkError, normalizeApiError, ApiError } from './errors'

const BASE_URL = import.meta.env.VITE_API_BASE_URL

if (!BASE_URL) {
  // Falla rápido en arranque si falta la configuración (mentalidad de producción).
  throw new Error('VITE_API_BASE_URL no está definida. Copia .env.example a .env.')
}

// ── Manejo global de 401 ────────────────────────────────────────────────────
type UnauthorizedHandler = () => void
let unauthorizedHandler: UnauthorizedHandler | null = null

/** Registra el handler que limpia la sesión y redirige a login ante un 401. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

// ── Tipos de petición ───────────────────────────────────────────────────────
export type QueryValue = string | number | boolean | null | undefined | number[]
export type QueryParams = Record<string, QueryValue>
type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

interface RequestOptions {
  query?: QueryParams
  body?: unknown
  signal?: AbortSignal
  /** No dispara el handler global de 401 (p. ej. login: el 401 es "credenciales inválidas"). */
  suppressAuthHandler?: boolean
}

function buildUrl(path: string, query?: QueryParams): string {
  const url = new URL(`${BASE_URL}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        // Param repetible (`?item_ids=1&item_ids=2`), p. ej. para `.../export`.
        for (const item of value) url.searchParams.append(key, String(item))
      } else if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return url.toString()
}

/**
 * Fetch + manejo de errores compartido por `apiRequest` (JSON) y `fetchBlob` (descarga de
 * archivo): adjunta la cookie de sesión, y ante `!response.ok` parsea el `detail` estándar
 * de `AppHttpException` y lo normaliza a `ApiError` con el `X-Request-ID` de la respuesta.
 * Devuelve el `Response` crudo en éxito — cada llamador decide cómo leer el cuerpo.
 */
async function runRequest(
  method: HttpMethod,
  path: string,
  options: RequestOptions,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const { query, body, signal, suppressAuthHandler } = options
  const headers: Record<string, string> = { ...extraHeaders }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch {
    // fetch solo rechaza por errores de red / CORS / abort.
    throw networkError()
  }

  if (!response.ok) {
    // Las respuestas de error son siempre JSON; un cuerpo vacío se trata como `{}`.
    const text = await response.text()
    let parsed: unknown = {}
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = {}
      }
    }
    if (response.status === 401 && !suppressAuthHandler) {
      unauthorizedHandler?.()
    }
    // El backend adjunta `X-Request-ID` a toda respuesta; se muestra en los estados de error.
    const requestId = response.headers.get('X-Request-ID') ?? undefined
    throw normalizeApiError(response.status, parsed, requestId)
  }

  return response
}

/**
 * Núcleo de toda llamada JSON a la API. Parsea y valida la respuesta contra `schema`.
 */
async function apiRequest<S extends z.ZodTypeAny>(
  method: HttpMethod,
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.output<S>> {
  const response = await runRequest(method, path, options, { Accept: 'application/json' })

  const text = await response.text()
  let parsed: unknown = {}
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = {}
    }
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    // Contrato desincronizado entre frontend y backend: error de programación, no del usuario.
    console.error('[api] Respuesta no conforme al contrato:', path, result.error.issues)
    throw new ApiError({ status: 0, message: 'La API devolvió una respuesta inesperada.' })
  }
  return result.data
}

/**
 * Escape hatch: petición JSON validada contra un schema ARBITRARIO (envelope incluido), para
 * el endpoint raro cuya respuesta no encaja en los helpers de abajo. Documenta siempre el
 * motivo en el llamador; si el shape es el estándar, usa `fetchData`/`fetchPage`/`fetchList`.
 */
export function requestJson<S extends z.ZodTypeAny>(
  method: HttpMethod,
  path: string,
  schema: S,
  options?: RequestOptions,
): Promise<z.output<S>> {
  return apiRequest(method, path, schema, options)
}

const DEFAULT_DOWNLOAD_FILENAME = 'export.sql'

/** Extrae `filename="..."` de `Content-Disposition`; cae al nombre por defecto si no viene. */
function extractFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return DEFAULT_DOWNLOAD_FILENAME
  const match = /filename="?([^";]+)"?/.exec(contentDisposition)
  return match?.[1] ?? DEFAULT_DOWNLOAD_FILENAME
}

/**
 * GET que devuelve una descarga de archivo cruda (p. ej. `.../export`), no el envelope
 * `ApiResponse` JSON del resto de la API. Los errores (4xx/5xx) sí llegan como JSON estándar
 * y se normalizan igual que en `apiRequest` (vía `runRequest`).
 */
export async function fetchBlob(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; filename: string }> {
  const response = await runRequest('GET', path, options)
  const blob = await response.blob()
  const filename = extractFilename(response.headers.get('Content-Disposition'))
  return { blob, filename }
}

// ── Helpers tipados sobre el envelope `ApiResponse[T]` ──────────────────────

/** GET/acción que devuelve `{ data }`; retorna `data`. */
export async function fetchData<T extends z.ZodTypeAny>(
  path: string,
  dataSchema: T,
  options?: RequestOptions,
): Promise<z.infer<T>> {
  const result = await apiRequest('GET', path, envelope(dataSchema), options)
  // El validador garantiza `data`; el tipo mapeado de Zod no es indexable de forma directa.
  return (result as { data: z.infer<T> }).data
}

/** GET paginado; retorna `{ items, pagination }`. */
export async function fetchPage<T extends z.ZodTypeAny>(
  path: string,
  itemSchema: T,
  options?: RequestOptions,
): Promise<Page<z.infer<T>>> {
  const result = await apiRequest('GET', path, paginatedEnvelope(itemSchema), options)
  return { items: result.data, pagination: result.pagination }
}

/** GET de lista NO paginada (p. ej. `/privileges`); retorna el array. */
export async function fetchList<T extends z.ZodTypeAny>(
  path: string,
  itemSchema: T,
  options?: RequestOptions,
): Promise<z.infer<T>[]> {
  const result = await apiRequest('GET', path, listEnvelope(itemSchema), options)
  return result.data
}

/** Mutación (POST/PATCH/DELETE) que devuelve `{ data }`; retorna `data`. */
export async function mutateData<T extends z.ZodTypeAny>(
  method: HttpMethod,
  path: string,
  dataSchema: T,
  options?: RequestOptions,
): Promise<z.infer<T>> {
  const result = await apiRequest(method, path, envelope(dataSchema), options)
  return (result as { data: z.infer<T> }).data
}

/** Mutación sin contenido (DELETE / acciones void); retorna el `message` opcional. */
export async function mutateVoid(
  method: HttpMethod,
  path: string,
  options?: RequestOptions,
): Promise<string | undefined> {
  const result = await apiRequest(method, path, emptyEnvelopeSchema, options)
  return result.message
}
