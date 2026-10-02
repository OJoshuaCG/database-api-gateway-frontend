import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { CAPABILITY_GRANT_ERROR_CODES } from '@/lib/contracts'
import {
  capabilityGrantBlockedMessage,
  capabilityGrantErrorMessage,
  NOT_ASSIGNABLE_MESSAGE,
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

  it('`not_assignable` (reemplazo del techo, C3) dice que lo asigna access_admin', () => {
    expect(
      capabilityGrantErrorMessage(error(409, CAPABILITY_GRANT_ERROR_CODES.notAssignable)),
    ).toBe(NOT_ASSIGNABLE_MESSAGE)
  })

  it('el código retirado `grant_ceiling_exceeded` ya no tiene copy propio', () => {
    expect(capabilityGrantErrorMessage(error(409, 'access.grant_ceiling_exceeded'))).toBeNull()
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

  it('`not_assignable` como motivo de bloqueo usa el mismo copy que el error', () => {
    expect(capabilityGrantBlockedMessage('access.not_assignable')).toBe(NOT_ASSIGNABLE_MESSAGE)
  })
})

describe('separación de deberes en las capacidades puntuales', () => {
  const sod = CAPABILITY_GRANT_ERROR_CODES.sodConflict

  it('el alta ofrece la excepción; aprobar no (no acepta `sod_override`)', () => {
    expect(capabilityGrantErrorMessage(error(409, sod))).toContain('declará una excepción')
    const decision = capabilityGrantErrorMessage(error(409, sod), { decision: true })
    expect(decision).toMatch(/^No se puede aprobar:/)
    expect(decision).not.toContain('declará una excepción')
  })

  it('el `blocked_reason` de la bandeja explica la regla y la salida', () => {
    const message = capabilityGrantBlockedMessage(sod)
    expect(message).toContain('Una misma cuenta no puede ser oficial de seguridad y a la vez owner')
    expect(message).toContain('excepción de emergencia desde sus accesos')
  })

  it('el override inválido dice los límites que mandó el servidor', () => {
    const invalid = new ApiError({
      status: 422,
      message: 'mensaje del backend',
      code: CAPABILITY_GRANT_ERROR_CODES.sodOverrideInvalid,
      gatewayUserContext: { sodReasonMinLength: 30, sodMaxHours: 72 },
    })
    expect(capabilityGrantErrorMessage(invalid)).toBe(
      'La excepción de emergencia no es válida: el motivo necesita al menos 30 caracteres y la duración va de 1 a 72 horas.',
    )
  })
})
