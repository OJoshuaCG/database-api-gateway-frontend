import { describe, expect, it } from 'vitest'
import { ApiError, type ApiReason } from '@/lib/api/errors'
import {
  classifyQueryError,
  isAutoRecoverable,
  isSystemFailure,
  reasonLink,
  suggestsProvidedMode,
} from './messages'

/** Errores reales, no mocks: la clasificación lee `status`, `message` y `reasons` de la clase. */
function apiError(status: number, message = 'Fallo', reasons?: ApiReason[]): ApiError {
  return new ApiError({ status, message, reasons })
}

const SERVER_ID = 42

describe('classifyQueryError', () => {
  it('trata el 410 como token caducado y re-pide el preview', () => {
    expect(classifyQueryError(apiError(410, 'El token de confirmación expiró.'))).toBe(
      'retryPreview',
    )
  })

  it('trata el 422 de token que ya no corresponde como re-preview', () => {
    expect(
      classifyQueryError(apiError(422, 'El confirm_token no corresponde a esta consulta.')),
    ).toBe('retryPreview')
    expect(
      classifyQueryError(apiError(422, 'El token de confirmación no corresponde a esta consulta.')),
    ).toBe('retryPreview')
  })

  it('distingue el 422 del nombre tipeado que no coincide', () => {
    expect(
      classifyQueryError(apiError(422, 'confirm_target_name debe coincidir con la base.')),
    ).toBe('nameMismatch')
  })

  it('distingue el 422 de impersonación no soportada', () => {
    expect(
      classifyQueryError(apiError(422, 'La impersonación con SET ROLE solo existe en PostgreSQL.')),
    ).toBe('impersonateUnsupported')
  })

  it('distingue el 422 de SQL por encima del tope', () => {
    expect(classifyQueryError(apiError(422, 'El SQL supera el tope de 262144 bytes.'))).toBe(
      'sqlTooLarge',
    )
  })

  it('deja el resto de los 422 como petición inválida', () => {
    expect(classifyQueryError(apiError(422, 'Falta el usuario del modo stored.'))).toBe(
      'invalidRequest',
    )
  })

  it('separa el 403 de base de sistema del 403 de política', () => {
    const sistema = apiError(403, 'No se puede escribir sobre una base de sistema.', [
      { code: 'system_database_write', message: 'Escritura sobre base de sistema.' },
    ])
    expect(classifyQueryError(sistema)).toBe('systemDatabase')

    const politica = apiError(403, 'La política no ejecuta GRANT.', [
      { code: 'dcl_grant_revoke', message: 'GRANT/REVOKE no se ejecutan desde la consola.' },
    ])
    expect(classifyQueryError(politica)).toBe('blockedByPolicy')
    expect(classifyQueryError(apiError(403, 'Prohibido.'))).toBe('blockedByPolicy')
  })

  it('trata el 404 como usuario ausente del inventario', () => {
    expect(classifyQueryError(apiError(404, 'El usuario no existe en el inventario.'))).toBe(
      'storedUserMissing',
    )
  })

  it('separa los dos 409: metadatos del gateway vs. usuario sin contraseña', () => {
    expect(
      classifyQueryError(apiError(409, 'El destino es la base de metadatos del gateway.')),
    ).toBe('gatewayMetadata')
    expect(
      classifyQueryError(apiError(409, 'El gateway nunca fijó la contraseña de ese usuario.')),
    ).toBe('storedUserNoPassword')
  })

  it('trata el 429 como límite de peticiones', () => {
    expect(classifyQueryError(apiError(429, 'Demasiadas consultas.'))).toBe('rateLimited')
  })

  it('trata 502 y 504 como motor inalcanzable', () => {
    expect(classifyQueryError(apiError(502, 'Bad gateway'))).toBe('engineUnreachable')
    expect(classifyQueryError(apiError(504, 'Gateway timeout'))).toBe('engineUnreachable')
  })

  it('deja el 500 como error terminal', () => {
    expect(classifyQueryError(apiError(500, 'Boom'))).toBe('terminal')
  })
})

describe('isAutoRecoverable', () => {
  it('solo el re-preview se recupera solo', () => {
    expect(isAutoRecoverable('retryPreview')).toBe(true)
  })

  it('ninguna otra condición se reintenta sola', () => {
    for (const action of [
      'blockedByPolicy',
      'systemDatabase',
      'storedUserMissing',
      'storedUserNoPassword',
      'gatewayMetadata',
      'nameMismatch',
      'rateLimited',
      'engineUnreachable',
      'terminal',
    ] as const) {
      expect(isAutoRecoverable(action)).toBe(false)
    }
  })
})

describe('isSystemFailure', () => {
  it('marca como fallo del sistema el motor inalcanzable y el error terminal', () => {
    expect(isSystemFailure(classifyQueryError(apiError(502, 'Bad gateway')))).toBe(true)
    expect(isSystemFailure(classifyQueryError(apiError(504, 'Gateway timeout')))).toBe(true)
    expect(isSystemFailure(classifyQueryError(apiError(500, 'Boom')))).toBe(true)
  })

  it('un 403 de política NO es un fallo del sistema: es una decisión del gateway', () => {
    expect(isSystemFailure(classifyQueryError(apiError(403, 'Prohibido.')))).toBe(false)
  })

  it('tampoco lo son las demás condiciones del flujo', () => {
    for (const action of [
      'retryPreview',
      'systemDatabase',
      'storedUserMissing',
      'storedUserNoPassword',
      'gatewayMetadata',
      'impersonateUnsupported',
      'nameMismatch',
      'sqlTooLarge',
      'invalidRequest',
      'rateLimited',
    ] as const) {
      expect(isSystemFailure(action)).toBe(false)
    }
  })
})

describe('suggestsProvidedMode', () => {
  it('propone la contraseña a mano cuando el modo stored no sirvió', () => {
    expect(suggestsProvidedMode('storedUserMissing')).toBe(true)
    expect(suggestsProvidedMode('storedUserNoPassword')).toBe(true)
  })

  it('no la propone para el resto de las condiciones', () => {
    for (const action of [
      'retryPreview',
      'blockedByPolicy',
      'systemDatabase',
      'gatewayMetadata',
      'impersonateUnsupported',
      'rateLimited',
      'terminal',
    ] as const) {
      expect(suggestsProvidedMode(action)).toBe(false)
    }
  })
})

describe('reasonLink', () => {
  it('enlaza los GRANT/REVOKE a Usuarios y permisos', () => {
    expect(reasonLink('dcl_grant_revoke', SERVER_ID)).toEqual({
      to: '/server-users',
      label: 'Ir a Usuarios y permisos',
    })
  })

  it('enlaza el ciclo de vida de usuarios al servidor recibido', () => {
    const link = reasonLink('dcl_user_role', SERVER_ID)
    expect(link?.to).toContain(`/servers/${SERVER_ID}`)
    expect(link?.to).toBe(`/servers/${SERVER_ID}?tab=users`)
  })

  it('enlaza el ciclo de vida de bases al servidor recibido', () => {
    const link = reasonLink('database_lifecycle', SERVER_ID)
    expect(link?.to).toContain(`/servers/${SERVER_ID}`)
    expect(link?.to).toBe(`/servers/${SERVER_ID}?tab=databases`)
  })

  it('enlaza el COPY al módulo de clonado', () => {
    expect(reasonLink('copy_statement', SERVER_ID)?.to).toBe('/database-clones')
  })

  it('no inventa destino para un código desconocido', () => {
    // Inventar un enlace para un motivo nuevo del backend confundiría más de lo que ayuda.
    expect(reasonLink('opaque_statement', SERVER_ID)).toBeNull()
    expect(reasonLink('codigo_que_no_existe', SERVER_ID)).toBeNull()
  })
})
