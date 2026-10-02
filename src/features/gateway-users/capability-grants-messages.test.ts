import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { CAPABILITY_GRANT_ERROR_CODES } from '@/lib/contracts'
import {
  capabilityGrantBlockedMessage,
  capabilityGrantErrorMessage,
  GRANT_CEILING_FALLBACK,
  RATE_LIMIT_HINT,
} from './messages'

function error(status: number, code?: string) {
  return new ApiError({ status, message: 'mensaje del backend', code })
}

describe('capabilityGrantErrorMessage', () => {
  const codes = Object.values(CAPABILITY_GRANT_ERROR_CODES)

  it.each(codes)('%s tiene copy propio en voseo, nunca el mensaje del backend', (code) => {
    const message = capabilityGrantErrorMessage(error(409, code))
    expect(message).toBeTruthy()
    expect(message).not.toContain('mensaje del backend')
    // Voseo rioplatense: ningún imperativo en «tú» ni «puedes».
    expect(message).not.toMatch(/\bpuedes\b|\btienes\b/u)
  })

  it('el techo sin msg del backend usa el respaldo', () => {
    expect(
      capabilityGrantErrorMessage(error(409, CAPABILITY_GRANT_ERROR_CODES.grantCeilingExceeded)),
    ).toBe(GRANT_CEILING_FALLBACK)
  })

  it('el auto-otorgamiento habla de capacidades, no del PUT de accesos', () => {
    const message = capabilityGrantErrorMessage(
      error(409, CAPABILITY_GRANT_ERROR_CODES.selfModificationForbidden),
    )
    expect(message).toContain('otorgarte')
  })

  it('cae al copy general del módulo (429) y a null en un código ajeno', () => {
    expect(capabilityGrantErrorMessage(error(429))).toBe(RATE_LIMIT_HINT)
    expect(capabilityGrantErrorMessage(error(500, 'otra.cosa'))).toBeNull()
  })
})

describe('capabilityGrantBlockedMessage', () => {
  it('traduce el blocked_reason de la bandeja', () => {
    expect(capabilityGrantBlockedMessage('access.self_approval_forbidden')).toContain('pediste')
  })

  it('sin motivo devuelve null y con un código desconocido da un genérico', () => {
    expect(capabilityGrantBlockedMessage(null)).toBeNull()
    expect(capabilityGrantBlockedMessage(undefined)).toBeNull()
    expect(capabilityGrantBlockedMessage('access.nuevo')).toContain('No podés decidir')
  })

  it('el techo excedido usa el respaldo, que es voseo', () => {
    expect(capabilityGrantBlockedMessage('access.grant_ceiling_exceeded')).toBe(
      GRANT_CEILING_FALLBACK,
    )
  })
})
