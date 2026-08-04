import { describe, expect, it } from 'vitest'
import {
  latestVersionOf,
  resolveVersionIndex,
  sortVersionsAscending,
  versionNeighbors,
} from './version-nav'

const versions = (...list: string[]) => list.map((version) => ({ version }))

describe('sortVersionsAscending', () => {
  it('ordena por valor numérico, no lexicográfico', () => {
    // Como texto, '10' iría antes que '9': el orden de versiones es NUMÉRICO (§8).
    const sorted = sortVersionsAscending(versions('10', '9', '2'))
    expect(sorted.map((m) => m.version)).toEqual(['2', '9', '10'])
  })

  it('ordena versiones con relleno de ceros', () => {
    const sorted = sortVersionsAscending(versions('0003', '0001', '0012', '0002'))
    expect(sorted.map((m) => m.version)).toEqual(['0001', '0002', '0003', '0012'])
  })

  it('no depende del orden en que las devuelva el backend', () => {
    const asc = sortVersionsAscending(versions('0001', '0002', '0003'))
    const desc = sortVersionsAscending(versions('0003', '0002', '0001'))
    expect(asc).toEqual(desc)
  })

  it('no muta la lista original', () => {
    const original = versions('0002', '0001')
    sortVersionsAscending(original)
    expect(original.map((m) => m.version)).toEqual(['0002', '0001'])
  })

  it('tolera una versión con formato inesperado sin desordenar el resto', () => {
    const sorted = sortVersionsAscending(versions('0002', 'draft', '0001'))
    expect(sorted).toHaveLength(3)
    expect(sorted.map((m) => m.version)).toContain('draft')
  })

  it('soporta la lista vacía', () => {
    expect(sortVersionsAscending([])).toEqual([])
  })
})

describe('resolveVersionIndex', () => {
  const sorted = versions('0001', '0002', '0003')

  it('sin selección explícita cae en la ÚLTIMA, no en la primera', () => {
    expect(resolveVersionIndex(sorted, null)).toBe(2)
  })

  it('respeta la versión elegida por el admin', () => {
    expect(resolveVersionIndex(sorted, '0001')).toBe(0)
    expect(resolveVersionIndex(sorted, '0002')).toBe(1)
  })

  it('vuelve a la última si la versión elegida ya no existe (p. ej. se borró la punta)', () => {
    expect(resolveVersionIndex(sorted, '0009')).toBe(2)
  })

  it('devuelve -1 con la lista vacía', () => {
    expect(resolveVersionIndex([], null)).toBe(-1)
    expect(resolveVersionIndex([], '0001')).toBe(-1)
  })
})

describe('latestVersionOf', () => {
  it('devuelve la punta de una lista ordenada', () => {
    expect(latestVersionOf(versions('0001', '0002', '0012'))).toBe('0012')
  })

  it('devuelve null con la lista vacía', () => {
    expect(latestVersionOf([])).toBeNull()
  })
})

describe('versionNeighbors', () => {
  const sorted = versions('0001', '0002', '0003')

  it('en la primera no hay anterior', () => {
    expect(versionNeighbors(sorted, 0)).toMatchObject({
      previous: null,
      next: '0002',
      position: 1,
      total: 3,
      isLatest: false,
    })
  })

  it('en el medio hay ambos vecinos', () => {
    expect(versionNeighbors(sorted, 1)).toMatchObject({
      previous: '0001',
      next: '0003',
      position: 2,
      isLatest: false,
    })
  })

  it('en la punta no hay siguiente y se marca como la más reciente', () => {
    expect(versionNeighbors(sorted, 2)).toMatchObject({
      previous: '0002',
      next: null,
      position: 3,
      isLatest: true,
    })
  })

  it('con una sola versión no hay navegación posible', () => {
    expect(versionNeighbors(versions('0001'), 0)).toMatchObject({
      previous: null,
      next: null,
      position: 1,
      total: 1,
      isLatest: true,
    })
  })

  it('con la lista vacía no ofrece nada', () => {
    expect(versionNeighbors([], -1)).toMatchObject({
      previous: null,
      next: null,
      position: 0,
      total: 0,
      isLatest: false,
    })
  })
})
