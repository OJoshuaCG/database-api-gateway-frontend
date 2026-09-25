import type { QueryParams } from '@/lib/api/client'
import {
  MIGRATION_SEARCH_MIN_LENGTH,
  type MigrationSearchHit,
  type MigrationSearchSnippet,
} from '@/lib/contracts'

/**
 * Lógica pura de la búsqueda en el SQL de las versiones (`GET .../migrations/search`).
 *
 * Vive fuera del componente para poder probarla sin React: qué parámetros viajan, cuándo se puede
 * pedir y cómo se parte un fragmento para resaltarlo son las tres cosas que, si fallan, fallan en
 * silencio —una request con un filtro de más, un resaltado corrido—.
 */

/** Presets de «solo las últimas N versiones». `null` = todas, y se traduce en OMITIR `last`. */
export const MIGRATION_SEARCH_LAST_PRESETS = [5, 10, 20, 50, null] as const
export type MigrationSearchLast = (typeof MIGRATION_SEARCH_LAST_PRESETS)[number]

export type MigrationSearchOrder = 'asc' | 'desc'

export interface MigrationSearchFilters {
  /** Tal como lo escribió el operador: el recorte se hace al armar la request. */
  q: string
  caseSensitive: boolean
  last: MigrationSearchLast
  /** `YYYY-MM-DD` o `''` (sin límite), que es lo que entrega `<input type="date">`. */
  dateFrom: string
  dateTo: string
  order: MigrationSearchOrder
}

export const DEFAULT_MIGRATION_SEARCH_FILTERS: MigrationSearchFilters = {
  q: '',
  caseSensitive: false,
  last: null,
  dateFrom: '',
  dateTo: '',
  order: 'desc',
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** `q` como lo cuenta y lo busca el backend: sin los espacios de los extremos. */
export function normalizeSearchTerm(q: string): string {
  return q.trim()
}

/** ¿El término alcanza el mínimo? Por debajo no se pide nada: es ayuda, no error. */
export function isSearchTermReady(q: string): boolean {
  return normalizeSearchTerm(q).length >= MIGRATION_SEARCH_MIN_LENGTH
}

/**
 * Motivo por el que el rango de fechas no es válido, o `null` si lo es.
 *
 * Cualquiera de los dos extremos solo es válido. Como los dos son `YYYY-MM-DD`, compararlos como
 * texto es compararlos como fecha, sin pasar por `Date` y sus zonas horarias —que es justo lo que
 * el backend tampoco hace: compara `created_at` por día.
 */
export function dateRangeError(dateFrom: string, dateTo: string): string | null {
  if (dateFrom !== '' && !DATE_PATTERN.test(dateFrom)) return 'La fecha «desde» no es válida.'
  if (dateTo !== '' && !DATE_PATTERN.test(dateTo)) return 'La fecha «hasta» no es válida.'
  if (dateFrom !== '' && dateTo !== '' && dateFrom > dateTo) {
    return 'La fecha «desde» es posterior a la fecha «hasta»: ninguna versión podría cumplir las dos.'
  }
  return null
}

/** ¿Se puede pedir la búsqueda con estos filtros? El 422 del backend queda como red de seguridad. */
export function canRunMigrationSearch(filters: MigrationSearchFilters): boolean {
  return isSearchTermReady(filters.q) && dateRangeError(filters.dateFrom, filters.dateTo) === null
}

/** ¿Hay algún filtro que ACOTE el conjunto buscado? Sirve para sugerir ampliarlo si no hay nada. */
export function hasNarrowingFilters(filters: MigrationSearchFilters): boolean {
  return filters.last !== null || filters.dateFrom !== '' || filters.dateTo !== ''
}

/**
 * Query params de la request.
 *
 * Los opcionales se **omiten** (`undefined`, que `buildUrl` descarta) y nunca se mandan vacíos:
 * `last` «todas» es no mandarlo, una fecha vacía es no mandarla y `case_sensitive: false` es el
 * default. `order` sí viaja siempre: es explícito y no cuesta nada, y así el resultado no depende
 * de que el default del backend no cambie.
 */
export function buildMigrationSearchParams(
  filters: MigrationSearchFilters,
  page: number,
  size: number,
): QueryParams {
  return {
    q: normalizeSearchTerm(filters.q),
    case_sensitive: filters.caseSensitive ? true : undefined,
    last: filters.last ?? undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    order: filters.order,
    page,
    size,
  }
}

/**
 * Clave estable de los filtros, sin la página. Cuando cambia, la página vuelve a 1: con otro
 * término u otra ventana, la página 3 anterior designa otra cosa o ni siquiera existe.
 */
export function migrationSearchFiltersKey(filters: MigrationSearchFilters): string {
  return JSON.stringify(buildMigrationSearchParams(filters, 1, 1))
}

export interface SnippetParts {
  before: string
  match: string
  after: string
}

/**
 * Parte un fragmento en `[antes, coincidencia, después]` con los offsets TAL CUAL llegan.
 *
 * Sin `trim()` ni recálculo: los offsets son relativos al `text` recortado, `…` incluido, y
 * cualquier normalización los correría. Lo único que se hace es acotarlos: un offset fuera de
 * rango —o un `match_end` anterior al `match_start`— no puede romper el render; en el peor caso
 * el resaltado sale vacío y el texto se sigue leyendo entero.
 */
export function splitSnippet(
  snippet: Pick<MigrationSearchSnippet, 'text' | 'match_start' | 'match_end'>,
): SnippetParts {
  const { text } = snippet
  const start = clamp(snippet.match_start, 0, text.length)
  const end = clamp(snippet.match_end, start, text.length)
  return {
    before: text.slice(0, start),
    match: text.slice(start, end),
    after: text.slice(end),
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/** «3 coincidencias en 2 líneas», con los singulares bien puestos. */
export function matchSummary(hit: Pick<MigrationSearchHit, 'match_count' | 'lines_matched'>) {
  const matches = `${hit.match_count} ${hit.match_count === 1 ? 'coincidencia' : 'coincidencias'}`
  const lines = `${hit.lines_matched} ${hit.lines_matched === 1 ? 'línea' : 'líneas'}`
  return `${matches} en ${lines}`
}

/** Líneas con coincidencia que el backend no mandó (trae hasta 3). Nunca negativo. */
export function hiddenMatchedLines(
  hit: Pick<MigrationSearchHit, 'lines_matched' | 'snippets'>,
): number {
  return Math.max(0, hit.lines_matched - hit.snippets.length)
}
