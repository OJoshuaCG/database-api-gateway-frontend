import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import {
  AUTH_CSRF_ERROR_CODES,
  AUTH_SESSION_ERROR_CODES,
  AUTH_STEP_UP_ERROR_CODES,
} from '@/lib/contracts'
import {
  csrfErrorCopy,
  forbiddenCopy,
  isAccessForbidden,
  isCsrfError,
  isStepUpRequired,
  scopeHasGrantsMessage,
  sessionEndReason,
  stepUpErrorMessage,
} from './messages'

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

  it('isCsrfError acepta cualquier valor, como isAccessForbidden', () => {
    expect(isCsrfError(null)).toBe(false)
    expect(isCsrfError(undefined)).toBe(false)
    expect(isCsrfError(new Error('red caída'))).toBe(false)
  })
})

describe('forbiddenCopy / isAccessForbidden', () => {
  it('el copy compartido manda a «Mi acceso» y habla con voseo', () => {
    const copy = forbiddenCopy()
    expect(copy.title).toBe('No tenés acceso a esta acción')
    expect(copy.actionTo).toBe('/mi-cuenta')
    expect(copy.body).toContain('Revisá «Mi acceso»')
  })

  it('solo reconoce el 403 `access.forbidden`, no el de CSRF ni uno sin código', () => {
    expect(isAccessForbidden(error(403, 'access.forbidden'))).toBe(true)
    expect(isAccessForbidden(error(403, AUTH_CSRF_ERROR_CODES.invalid))).toBe(false)
    expect(isAccessForbidden(error(403))).toBe(false)
    expect(isAccessForbidden(error(401, 'access.forbidden'))).toBe(false)
    expect(isAccessForbidden(null)).toBe(false)
  })
})

describe('scopeHasGrantsMessage', () => {
  function scopeError(accessGrantCount?: number, capabilityGrantCount?: number) {
    return new ApiError({
      status: 409,
      message: 'mensaje del backend',
      code: 'access.scope_has_grants',
      gatewayUserContext: { accessGrantCount, capabilityGrantCount },
    })
  }

  it('nombra los dos conteos y a dónde apuntan', () => {
    expect(scopeHasGrantsMessage(scopeError(2, 3), 'environment')).toBe(
      'No se puede borrar: 2 permisos por alcance y 3 capacidades puntuales todavía apuntan a este entorno. Quitáselos primero desde la página de accesos de cada usuario.',
    )
  })

  it('pluraliza en singular y omite la parte en cero', () => {
    expect(scopeHasGrantsMessage(scopeError(1, 0), 'server')).toBe(
      'No se puede borrar: 1 permiso por alcance todavía apunta a este servidor. Quitáselos primero desde la página de accesos de cada usuario.',
    )
    expect(scopeHasGrantsMessage(scopeError(0, 1), 'server')).toContain(
      ': 1 capacidad puntual todavía apunta a este servidor.',
    )
  })

  it('sin conteos dice lo mismo sin inventar números', () => {
    const message = scopeHasGrantsMessage(scopeError(), 'server')
    expect(message).toContain('todavía hay accesos que apuntan a este servidor')
    expect(message).not.toMatch(/\d/)
  })

  it('no reclama otros códigos', () => {
    expect(scopeHasGrantsMessage(error(409, 'environment.has_databases'), 'environment')).toBeNull()
  })
})

describe('step-up', () => {
  it('explica el cierre por el quinto fallo de contraseña', () => {
    const reason = sessionEndReason(error(401, AUTH_SESSION_ERROR_CODES.stepUpFailed))
    expect(reason?.title).toContain('seguridad')
    expect(reason?.detail).toContain('cinco veces')
  })

  it('reconoce el 403 de step-up y no lo confunde con el de acceso', () => {
    const stepUp = error(403, AUTH_STEP_UP_ERROR_CODES.required)
    expect(isStepUpRequired(stepUp)).toBe(true)
    expect(isAccessForbidden(stepUp)).toBe(false)
    expect(isStepUpRequired(error(403, 'access.forbidden'))).toBe(false)
  })

  it('dice cuántos intentos quedan ante una contraseña incorrecta', () => {
    const failed = (left?: number) =>
      new ApiError({
        status: 400,
        message: 'x',
        code: AUTH_STEP_UP_ERROR_CODES.failed,
        attemptsRemaining: left,
      })
    expect(stepUpErrorMessage(failed(3))).toContain('Te quedan 3 intentos')
    expect(stepUpErrorMessage(failed(1))).toContain('último intento')
    expect(stepUpErrorMessage(failed())).toBe('La contraseña no es correcta.')
  })

  it('pide esperar ante el 429', () => {
    expect(stepUpErrorMessage(error(429))).toContain('Esperá un minuto')
  })
})
