import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { AUTH_CSRF_ERROR_CODES, AUTH_SESSION_ERROR_CODES } from '@/lib/contracts'
import { csrfErrorCopy, isCsrfError, sessionEndReason } from './messages'

function error(status: number, code?: string) {
  return new ApiError({ status, message: 'mensaje del backend', code })
}

describe('sessionEndReason', () => {
  it('distingue el vencimiento ABSOLUTO del de inactividad', () => {
    // Es la diferencia que más importa: el absoluto echa al usuario MIENTRAS trabaja, y sin
    // explicarlo se lee como un bug de la app.
    const absolute = sessionEndReason(error(401, AUTH_SESSION_ERROR_CODES.absolute))
    const idle = sessionEndReason(error(401, AUTH_SESSION_ERROR_CODES.idle))

    expect(absolute?.title).toContain('duración máxima')
    expect(absolute?.detail).toContain('12 horas')
    expect(idle?.title).toContain('inactividad')
    expect(absolute?.title).not.toBe(idle?.title)
  })

  it('explica el cierre por cambio de rol', () => {
    const reason = sessionEndReason(error(401, AUTH_SESSION_ERROR_CODES.roleChange))
    expect(reason?.detail).toContain('rol')
  })

  it('devuelve null para «no hay sesión», que es el login normal', () => {
    // Un cartel de «tu sesión terminó» en la primera visita de alguien que nunca entró es ruido
    // que entrena a ignorar el cartel cuando sí importa.
    expect(sessionEndReason(error(401, AUTH_SESSION_ERROR_CODES.missing))).toBeNull()
    expect(sessionEndReason(error(401, AUTH_SESSION_ERROR_CODES.unknown))).toBeNull()
  })

  it('devuelve null si el 401 no trae código', () => {
    expect(sessionEndReason(error(401))).toBeNull()
  })

  it('ignora los que no son 401', () => {
    expect(sessionEndReason(error(403, AUTH_SESSION_ERROR_CODES.absolute))).toBeNull()
  })
})

describe('csrfErrorCopy', () => {
  it('reconoce los tres códigos de CSRF', () => {
    expect(csrfErrorCopy(error(403, AUTH_CSRF_ERROR_CODES.missing))).toBeTruthy()
    expect(csrfErrorCopy(error(403, AUTH_CSRF_ERROR_CODES.invalid))).toBeTruthy()
    expect(csrfErrorCopy(error(403, AUTH_CSRF_ERROR_CODES.originRejected))).toBeTruthy()
    expect(isCsrfError(error(403, AUTH_CSRF_ERROR_CODES.missing))).toBe(true)
  })

  it('manda a RECARGAR y nunca a tocar la cookie', () => {
    // El servidor recompute el token: no es double-submit, así que escribir la cookie desde JS
    // no arregla nada. El copy no debe sugerirlo ni de casualidad.
    const copy = csrfErrorCopy(error(403, AUTH_CSRF_ERROR_CODES.invalid)) ?? ''
    expect(copy).toContain('Recargá')
    expect(copy.toLowerCase()).not.toContain('cookie')
  })

  it('no reclama un 403 de autorización', () => {
    // `access.forbidden` es otra cosa: falta una capacidad, no el token del formulario.
    expect(csrfErrorCopy(error(403, 'access.forbidden'))).toBeNull()
    expect(isCsrfError(error(403, 'access.forbidden'))).toBe(false)
  })
})
