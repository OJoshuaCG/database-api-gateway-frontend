import { describe, expect, it } from 'vitest'
import { API_TOKEN_DATA_MAX_TTL_DAYS } from '@/lib/contracts'
import { dataScopesOf, dataScopeTtlBlocked, remainingDays } from './data-scopes'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-03T12:00:00Z')

function utcInDays(days: number): string {
  return new Date(NOW + days * DAY_MS).toISOString().slice(0, 19)
}

describe('dataScopesOf', () => {
  it('devuelve solo los scopes de datos, en orden', () => {
    expect(dataScopesOf(['blueprints.read', 'data.query', 'data.read'])).toEqual([
      'data.query',
      'data.read',
    ])
    expect(dataScopesOf(['blueprints.read'])).toEqual([])
  })
})

describe('remainingDays', () => {
  it('lee el UTC sin zona como UTC', () => {
    expect(remainingDays(utcInDays(10), NOW)).toBeCloseTo(10, 5)
  })

  it('devuelve null sin fecha o con una fecha ilegible', () => {
    expect(remainingDays(null, NOW)).toBeNull()
    expect(remainingDays(undefined, NOW)).toBeNull()
    expect(remainingDays('pronto', NOW)).toBeNull()
  })
})

describe('dataScopeTtlBlocked', () => {
  it('bloquea datos si al token le queda más que el tope', () => {
    expect(
      dataScopeTtlBlocked(['data.read'], utcInDays(API_TOKEN_DATA_MAX_TTL_DAYS + 5), NOW),
    ).toBe(true)
  })

  it('no bloquea si le queda el tope o menos', () => {
    expect(dataScopeTtlBlocked(['data.read'], utcInDays(API_TOKEN_DATA_MAX_TTL_DAYS), NOW)).toBe(
      false,
    )
    expect(dataScopeTtlBlocked(['data.read'], utcInDays(3), NOW)).toBe(false)
  })

  it('un token largo sigue editándose sin datos', () => {
    expect(dataScopeTtlBlocked(['blueprints.read'], utcInDays(80), NOW)).toBe(false)
  })

  it('sin fecha legible no inventa un bloqueo: decide el servidor', () => {
    expect(dataScopeTtlBlocked(['data.read'], null, NOW)).toBe(false)
  })
})
