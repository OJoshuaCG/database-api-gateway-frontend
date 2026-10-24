import { describe, expect, it } from 'vitest'
import type { ChannelResolutionOut } from '@/lib/contracts'
import { derivedReferenceOf, isBackwardPromotion } from './blueprint-channels'

function resolution(overrides: Partial<ChannelResolutionOut> = {}): ChannelResolutionOut {
  return {
    channel_slug: 'stable',
    channel_name: 'Estable',
    resolution_mode: 'manual',
    resolved: true,
    databases: [],
    ...overrides,
  }
}

describe('isBackwardPromotion', () => {
  it('es retroceso cuando el destino es menor que el actual', () => {
    expect(isBackwardPromotion('0008', '0006')).toBe(true)
  })

  it('no es retroceso al avanzar ni al repetir la versión', () => {
    expect(isBackwardPromotion('0006', '0008')).toBe(false)
    expect(isBackwardPromotion('0006', '0006')).toBe(false)
  })

  it('compara como número, no como texto', () => {
    expect(isBackwardPromotion('0010', '0009')).toBe(true)
    expect(isBackwardPromotion('0009', '0010')).toBe(false)
  })

  it('sin versión actual, sin destino o con valores no numéricos no anticipa nada', () => {
    expect(isBackwardPromotion(null, '0001')).toBe(false)
    expect(isBackwardPromotion('0001', undefined)).toBe(false)
    expect(isBackwardPromotion('abc', '0001')).toBe(false)
  })
})

describe('derivedReferenceOf', () => {
  it('en un canal derivado la propia resolución es la referencia', () => {
    const derived = resolution({ resolution_mode: 'derived', version: '0004' })
    expect(derivedReferenceOf(derived)?.version).toBe('0004')
  })

  it('en un canal manual usa `derived_reference` y sin ella devuelve null', () => {
    const reference = {
      resolved: true,
      version: '0003',
      databases: [],
    }
    expect(derivedReferenceOf(resolution({ derived_reference: reference }))?.version).toBe('0003')
    expect(derivedReferenceOf(resolution())).toBeNull()
  })
})
