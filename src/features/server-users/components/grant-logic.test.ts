import { describe, expect, it } from 'vitest'
import type { GrantInfo } from '@/lib/contracts'
import {
  BULK_CHUNK_SIZE,
  EMPTY_OBJECT_DRAFT,
  buildObjectRef,
  chunk,
  filterGrantsByDatabase,
  gatePrivilegesIn,
  missingObjectFields,
  outcomeRowsFromBulk,
} from './grant-logic'

describe('buildObjectRef', () => {
  it('a nivel database solo emite la base', () => {
    expect(buildObjectRef('database', EMPTY_OBJECT_DRAFT, 'shop', false)).toEqual({
      database: 'shop',
    })
  })

  it('omite `schema` fuera de PostgreSQL aunque el borrador lo traiga', () => {
    const draft = { ...EMPTY_OBJECT_DRAFT, schema: 'ventas', table: 'orders' }
    expect(buildObjectRef('table', draft, 'shop', false)).toEqual({
      database: 'shop',
      table: 'orders',
    })
    expect(buildObjectRef('table', draft, 'shop', true)).toEqual({
      database: 'shop',
      schema: 'ventas',
      table: 'orders',
    })
  })

  it('parte las columnas por coma y descarta las vacías', () => {
    const draft = { ...EMPTY_OBJECT_DRAFT, table: 'clients', columns: 'email, , nombre ' }
    expect(buildObjectRef('column', draft, 'shop', false).columns).toEqual(['email', 'nombre'])
  })

  it('sin base no emite `database`: es el caso del bulk, que la sobrescribe él (v21 §11)', () => {
    const draft = { ...EMPTY_OBJECT_DRAFT, table: 'orders' }
    expect(buildObjectRef('table', draft, undefined, false)).toEqual({ table: 'orders' })
  })
})

describe('missingObjectFields', () => {
  it('detecta el objeto incompleto de cada nivel', () => {
    expect(missingObjectFields('database', EMPTY_OBJECT_DRAFT)).toEqual([])
    expect(missingObjectFields('table', EMPTY_OBJECT_DRAFT)).toEqual(['tabla'])
    expect(missingObjectFields('column', EMPTY_OBJECT_DRAFT)).toEqual(['tabla', 'columnas'])
    expect(missingObjectFields('sequence', EMPTY_OBJECT_DRAFT)).toEqual(['secuencia'])
    expect(missingObjectFields('routine', EMPTY_OBJECT_DRAFT)).toEqual(['rutina'])
  })
})

describe('gatePrivilegesIn', () => {
  it('reconoce los tokens sensibles sin importar mayúsculas ni espacios', () => {
    expect(gatePrivilegesIn(['SELECT', ' all privileges ', 'INSERT'])).toEqual([' all privileges '])
    expect(gatePrivilegesIn(['SELECT', 'INSERT'])).toEqual([])
  })
})

describe('chunk', () => {
  it('parte en tandas del tamaño del bulk', () => {
    const items = Array.from({ length: 25 }, (_, index) => index)
    expect(chunk(items, BULK_CHUNK_SIZE).map((batch) => batch.length)).toEqual([20, 5])
  })

  it('con lista vacía no produce ninguna tanda', () => {
    expect(chunk([], BULK_CHUNK_SIZE)).toEqual([])
  })
})

describe('filterGrantsByDatabase', () => {
  const grants: GrantInfo[] = [
    { level: 'global', object: null, privileges: ['PROCESS'], with_grant_option: false },
    { level: 'database', object: 'shop', privileges: ['SELECT'], with_grant_option: false },
    { level: 'table', object: 'shop.orders', privileges: ['UPDATE'], with_grant_option: false },
    {
      level: 'column',
      object: 'shop.orders(email)',
      privileges: ['SELECT'],
      with_grant_option: false,
    },
    { level: 'database', object: 'otra', privileges: ['SELECT'], with_grant_option: false },
  ]

  it('acota por el primer segmento del objeto y conserva los globales', () => {
    const result = filterGrantsByDatabase(grants, 'shop')
    expect(result.map((grant) => grant.object)).toEqual([
      null,
      'shop',
      'shop.orders',
      'shop.orders(email)',
    ])
  })

  it('ignora comillas y mayúsculas del nombre', () => {
    expect(filterGrantsByDatabase(grants, '`SHOP`')).toHaveLength(4)
  })

  it('sin base devuelve la lista intacta', () => {
    expect(filterGrantsByDatabase(grants, '   ')).toHaveLength(grants.length)
  })
})

describe('outcomeRowsFromBulk', () => {
  it('toma `ok` de cada resultado y no del status HTTP (v21 §11)', () => {
    const rows = outcomeRowsFromBulk([
      { database: 'shop_a', grants_applied: 2, skipped_levels: [], errors: [], ok: true },
      {
        database: 'shop_c',
        grants_applied: 1,
        skipped_levels: ['column'],
        errors: ['table: no existe'],
        ok: false,
      },
    ])
    expect(rows.map((row) => row.ok)).toEqual([true, false])
    expect(rows[1]?.skippedLevels).toEqual(['column'])
    expect(rows[1]?.errors).toEqual(['table: no existe'])
    expect(rows[0]?.detail).toBe('2 grant(s)')
  })
})
