import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUuid } from './uuid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('devuelve un UUID v4 bien formado', () => {
    expect(randomUuid()).toMatch(UUID_V4)
  })

  it('sigue devolviendo un UUID v4 sin `crypto.randomUUID` (contexto no seguro: HTTP plano)', () => {
    // Es el caso que rompía en producción: en HTTP plano `randomUUID` no existe y el manejador
    // moría con `TypeError`. `getRandomValues` sí sobrevive, y es de lo único que puede depender.
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    vi.stubGlobal('crypto', { getRandomValues })

    expect(randomUuid()).toMatch(UUID_V4)
  })

  it('no repite valores: sirve como clave de idempotencia', () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    vi.stubGlobal('crypto', { getRandomValues })

    const keys = new Set(Array.from({ length: 100 }, () => randomUuid()))
    expect(keys.size).toBe(100)
  })
})
