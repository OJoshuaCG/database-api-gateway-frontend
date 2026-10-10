import { describe, expect, it } from 'vitest'
import { CAPABILITIES, DESTRUCTIVE_CAPABILITIES } from './auth'

describe('capacidad integration_tokens.own', () => {
  it('existe con el valor del catálogo del backend y es distinta de tokens.own y access.admin', () => {
    expect(CAPABILITIES.integrationTokensOwn).toBe('integration_tokens.own')
    expect(CAPABILITIES.integrationTokensOwn).not.toBe(CAPABILITIES.tokensOwn)
    expect(CAPABILITIES.integrationTokensOwn).not.toBe(CAPABILITIES.accessAdmin)
  })

  it('no es destructiva: no entra en el respaldo de DESTRUCTIVE_CAPABILITIES', () => {
    expect(DESTRUCTIVE_CAPABILITIES).not.toContain(CAPABILITIES.integrationTokensOwn)
  })
})
