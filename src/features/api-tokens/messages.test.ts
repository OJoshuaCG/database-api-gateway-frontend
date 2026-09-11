import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { API_TOKEN_ERROR_CODES } from '@/lib/contracts'
import { apiTokenErrorMessage, RATE_LIMIT_HINT } from './messages'

function error(
  status: number,
  code?: string,
  extra?: Partial<ConstructorParameters<typeof ApiError>[0]>,
) {
  return new ApiError({ status, message: 'mensaje del backend', code, ...extra })
}

describe('apiTokenErrorMessage', () => {
  it('usa el max_days del backend cuando el TTL se pasa', () => {
    const message = apiTokenErrorMessage(
      error(422, API_TOKEN_ERROR_CODES.ttlTooLong, { apiTokenContext: { maxDays: 90 } }),
    )
    expect(message).toContain('90')
  })

  it('cae al tope documentado si el backend no manda max_days', () => {
    expect(apiTokenErrorMessage(error(422, API_TOKEN_ERROR_CODES.ttlTooLong))).toContain('90')
  })

  it('lista el techo de agente cuando el scope queda fuera', () => {
    const message = apiTokenErrorMessage(
      error(422, API_TOKEN_ERROR_CODES.scopeNotAllowed, {
        apiTokenContext: { allowed: ['blueprints.read', 'blueprints.write'] },
      }),
    )
    expect(message).toContain('blueprints.read, blueprints.write')
  })

  it('da un mensaje DISTINTO cuando el mismo código llega sin allowed[]', () => {
    // Sin `allowed[]` la causa no es «fuera del techo» sino un string que no es ninguna capacidad
    // conocida (un typo). Decir «elegí del techo» mandaría a buscar donde no está el problema.
    const message = apiTokenErrorMessage(error(422, API_TOKEN_ERROR_CODES.scopeNotAllowed))
    expect(message).toContain('no corresponde a ninguna capacidad conocida')
  })

  it('aclara que revocar de nuevo no fue lo que cortó el acceso', () => {
    expect(apiTokenErrorMessage(error(409, API_TOKEN_ERROR_CODES.alreadyRevoked))).toContain(
      'No fue esta acción',
    )
  })

  it('el 429 llega sin código, así que se enruta por status', () => {
    expect(apiTokenErrorMessage(error(429))).toBe(RATE_LIMIT_HINT)
  })

  it('devuelve null ante un código desconocido', () => {
    expect(apiTokenErrorMessage(error(500, 'otra.cosa'))).toBeNull()
  })
})
