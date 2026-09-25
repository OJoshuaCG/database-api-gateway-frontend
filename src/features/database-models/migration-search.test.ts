import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MIGRATION_SEARCH_FILTERS,
  buildMigrationSearchParams,
  canRunMigrationSearch,
  dateRangeError,
  hasNarrowingFilters,
  hiddenMatchedLines,
  isSearchTermReady,
  matchSummary,
  migrationSearchFiltersKey,
  splitSnippet,
  type MigrationSearchFilters,
} from './migration-search'

const filters = (patch: Partial<MigrationSearchFilters> = {}): MigrationSearchFilters => ({
  ...DEFAULT_MIGRATION_SEARCH_FILTERS,
  q: 'usuarios',
  ...patch,
})

describe('isSearchTermReady', () => {
  it('cuenta el mínimo sin los espacios de los extremos, como el backend', () => {
    expect(isSearchTermReady('   abc   ')).toBe(false)
    expect(isSearchTermReady('  abcd ')).toBe(true)
  })

  it('cuenta los espacios interiores: son parte del término', () => {
    expect(isSearchTermReady('a  b')).toBe(true)
  })
})

describe('dateRangeError', () => {
  it('acepta cualquiera de los dos extremos solo, o ninguno', () => {
    expect(dateRangeError('', '')).toBeNull()
    expect(dateRangeError('2026-09-01', '')).toBeNull()
    expect(dateRangeError('', '2026-09-30')).toBeNull()
  })

  it('acepta el mismo día en los dos extremos: el rango es inclusivo', () => {
    expect(dateRangeError('2026-09-10', '2026-09-10')).toBeNull()
  })

  it('rechaza «desde» posterior a «hasta»', () => {
    expect(dateRangeError('2026-09-11', '2026-09-10')).not.toBeNull()
  })

  it('rechaza una fecha que no es YYYY-MM-DD', () => {
    expect(dateRangeError('10/09/2026', '')).not.toBeNull()
  })
})

describe('canRunMigrationSearch', () => {
  it('no dispara por debajo del mínimo', () => {
    expect(canRunMigrationSearch(filters({ q: 'abc' }))).toBe(false)
  })

  it('no dispara con un rango de fechas invertido', () => {
    expect(canRunMigrationSearch(filters({ dateFrom: '2026-09-30', dateTo: '2026-09-01' }))).toBe(
      false,
    )
  })

  it('dispara con un término suficiente y fechas coherentes', () => {
    expect(canRunMigrationSearch(filters({ dateFrom: '2026-09-01' }))).toBe(true)
  })
})

describe('buildMigrationSearchParams', () => {
  it('manda `q` recortado', () => {
    expect(buildMigrationSearchParams(filters({ q: '  usuarios  ' }), 1, 20).q).toBe('usuarios')
  })

  it('omite los opcionales en vez de mandarlos vacíos', () => {
    const params = buildMigrationSearchParams(filters(), 1, 20)
    expect(params.last).toBeUndefined()
    expect(params.date_from).toBeUndefined()
    expect(params.date_to).toBeUndefined()
    // `false` es el default: mandarlo no aporta nada.
    expect(params.case_sensitive).toBeUndefined()
  })

  it('«Todas» las versiones es no mandar `last`', () => {
    expect(buildMigrationSearchParams(filters({ last: null }), 1, 20).last).toBeUndefined()
  })

  it('manda los filtros activos con los nombres del contrato', () => {
    const params = buildMigrationSearchParams(
      filters({
        caseSensitive: true,
        last: 20,
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        order: 'asc',
      }),
      3,
      20,
    )
    expect(params).toEqual({
      q: 'usuarios',
      case_sensitive: true,
      last: 20,
      date_from: '2026-09-01',
      date_to: '2026-09-30',
      order: 'asc',
      page: 3,
      size: 20,
    })
  })

  it('manda `order` siempre, aunque sea el default', () => {
    expect(buildMigrationSearchParams(filters(), 1, 20).order).toBe('desc')
  })
})

describe('migrationSearchFiltersKey', () => {
  it('no depende de la página: cambiar de página no resetea nada', () => {
    expect(migrationSearchFiltersKey(filters())).toBe(migrationSearchFiltersKey(filters()))
  })

  it('cambia con cada filtro, que es lo que devuelve la página a 1', () => {
    const base = migrationSearchFiltersKey(filters())
    expect(migrationSearchFiltersKey(filters({ q: 'pedidos' }))).not.toBe(base)
    expect(migrationSearchFiltersKey(filters({ caseSensitive: true }))).not.toBe(base)
    expect(migrationSearchFiltersKey(filters({ last: 5 }))).not.toBe(base)
    expect(migrationSearchFiltersKey(filters({ dateFrom: '2026-09-01' }))).not.toBe(base)
    expect(migrationSearchFiltersKey(filters({ dateTo: '2026-09-01' }))).not.toBe(base)
    expect(migrationSearchFiltersKey(filters({ order: 'asc' }))).not.toBe(base)
  })

  it('no cambia por espacios en los extremos: la request sería la misma', () => {
    expect(migrationSearchFiltersKey(filters({ q: ' usuarios ' }))).toBe(
      migrationSearchFiltersKey(filters()),
    )
  })
})

describe('splitSnippet', () => {
  it('parte con los offsets tal cual, match_end exclusivo', () => {
    expect(
      splitSnippet({ text: 'ALTER TABLE usuarios ADD x', match_start: 12, match_end: 20 }),
    ).toEqual({ before: 'ALTER TABLE ', match: 'usuarios', after: ' ADD x' })
  })

  it('cuenta el `…` del recorte y no recorta espacios', () => {
    const parts = splitSnippet({ text: '…  usuarios …', match_start: 3, match_end: 11 })
    expect(parts).toEqual({ before: '…  ', match: 'usuarios', after: ' …' })
  })

  it('acota offsets fuera de rango sin romper', () => {
    expect(splitSnippet({ text: 'abc', match_start: 1, match_end: 99 })).toEqual({
      before: 'a',
      match: 'bc',
      after: '',
    })
    expect(splitSnippet({ text: 'abc', match_start: 50, match_end: 60 })).toEqual({
      before: 'abc',
      match: '',
      after: '',
    })
  })

  it('con match_end anterior a match_start, resalta vacío y conserva el texto', () => {
    const parts = splitSnippet({ text: 'abcdef', match_start: 4, match_end: 2 })
    expect(parts.match).toBe('')
    expect(parts.before + parts.match + parts.after).toBe('abcdef')
  })
})

describe('matchSummary', () => {
  it('usa plural y singular', () => {
    expect(matchSummary({ match_count: 3, lines_matched: 2 })).toBe('3 coincidencias en 2 líneas')
    expect(matchSummary({ match_count: 1, lines_matched: 1 })).toBe('1 coincidencia en 1 línea')
  })
})

describe('hiddenMatchedLines', () => {
  const snippet = { line: 1, text: 'x', match_start: 0, match_end: 1 }

  it('cuenta las líneas con coincidencia que no vinieron', () => {
    expect(hiddenMatchedLines({ lines_matched: 7, snippets: [snippet, snippet, snippet] })).toBe(4)
  })

  it('nunca es negativo', () => {
    expect(hiddenMatchedLines({ lines_matched: 1, snippets: [snippet, snippet] })).toBe(0)
  })
})

describe('hasNarrowingFilters', () => {
  it('solo `last` y las fechas acotan el conjunto buscado', () => {
    expect(hasNarrowingFilters(filters({ caseSensitive: true, order: 'asc' }))).toBe(false)
    expect(hasNarrowingFilters(filters({ last: 10 }))).toBe(true)
    expect(hasNarrowingFilters(filters({ dateTo: '2026-09-30' }))).toBe(true)
  })
})
