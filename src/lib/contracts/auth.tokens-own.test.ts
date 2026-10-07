import { describe, expect, it } from 'vitest'
import { CAPABILITIES, DESTRUCTIVE_CAPABILITIES } from './auth'

describe('capacidad tokens.own', () => {
  it('existe con el valor del catálogo del backend y no reemplaza a access.admin', () => {
    expect(CAPABILITIES.tokensOwn).toBe('tokens.own')
    expect(CAPABILITIES.accessAdmin).toBe('access.admin')
    expect(CAPABILITIES.tokensOwn).not.toBe(CAPABILITIES.accessAdmin)
  })

  it('no es destructiva: no entra en el respaldo de DESTRUCTIVE_CAPABILITIES', () => {
    expect(DESTRUCTIVE_CAPABILITIES).not.toContain(CAPABILITIES.tokensOwn)
  })
})
