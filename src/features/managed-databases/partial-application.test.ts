import { describe, expect, it } from 'vitest'
import type { PartialApplicationEntry } from '@/lib/contracts/db-migrations'
import { hasResolvablePartial, isPartialResolvable } from './partial-application'

function entry(overrides: Partial<PartialApplicationEntry> = {}): PartialApplicationEntry {
  return {
    version: '0048',
    model_migration_id: 48,
    applied_statements: 18,
    total_statements: 20,
    reconcilable: false,
    reconcilable_with_force: false,
    statements_to_undo: 0,
    ...overrides,
  }
}

describe('isPartialResolvable', () => {
  it('acepta la parcial que se deshace por completo', () => {
    expect(isPartialResolvable(entry({ reconcilable: true, statements_to_undo: 18 }))).toBe(true)
  })

  it('acepta la parcial que solo se deshace con force', () => {
    // Es el caso que la UI escondía: hay reversos para parte de lo aplicado y el endpoint
    // los ejecuta con `force=true`. Mirando solo `reconcilable` el botón no aparecía.
    expect(
      isPartialResolvable(
        entry({
          reconcilable_with_force: true,
          statements_to_undo: 17,
          reason: '1 de las 18 sentencias aplicadas no tienen reverso conocido',
        }),
      ),
    ).toBe(true)
  })

  it('rechaza la parcial sin vía automática', () => {
    // Migración sin manifiesto de sentencias: la única salida es manual + stamp force, así
    // que la UI NO debe ofrecer reconciliar y SÍ debe habilitar el force del stamp.
    expect(
      isPartialResolvable(
        entry({ reason: 'esta versión no tiene manifiesto de sentencias para el motor destino' }),
      ),
    ).toBe(false)
  })
})

describe('hasResolvablePartial', () => {
  it('es false cuando ninguna parcial tiene vía automática', () => {
    expect(hasResolvablePartial([entry(), entry({ version: '0047' })])).toBe(false)
  })

  it('es true si al menos una la tiene, aunque sea solo con force', () => {
    expect(hasResolvablePartial([entry(), entry({ reconcilable_with_force: true })])).toBe(true)
  })

  it('es false sin parciales', () => {
    expect(hasResolvablePartial([])).toBe(false)
  })
})
