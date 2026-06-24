import { describe, expect, it } from 'vitest'
import { ApiError, normalizeApiError, networkError, toApiError } from './errors'

describe('normalizeApiError', () => {
  it('soporta `detail` como string (forma de api-reference.md)', () => {
    const error = normalizeApiError(404, { detail: 'Servidor no encontrado.' })
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(404)
    expect(error.message).toBe('Servidor no encontrado.')
  })

  it('soporta `detail` como objeto `{ msg, type }` (handlers reales)', () => {
    const error = normalizeApiError(409, {
      detail: { msg: 'Recurso duplicado', type: 'AppHttpException' },
    })
    expect(error.message).toBe('Recurso duplicado')
    expect(error.type).toBe('AppHttpException')
  })

  it('extrae errores por campo de un 422 con context array', () => {
    const error = normalizeApiError(422, {
      detail: {
        msg: 'Error de validación',
        type: 'RequestValidationError',
        context: [{ field: 'host', msg: 'host privado' }],
      },
    })
    expect(error.fieldErrors).toEqual([{ field: 'host', message: 'host privado' }])
  })

  it('usa un mensaje de fallback por status cuando no hay detalle utilizable', () => {
    const error = normalizeApiError(502, {})
    expect(error.message).toMatch(/servidor de base de datos destino/i)
    expect(error.isEngineError).toBe(true)
  })

  it('marca 401 como no autorizado', () => {
    expect(normalizeApiError(401, {}).isUnauthorized).toBe(true)
  })
})

describe('networkError / toApiError', () => {
  it('networkError es status 0', () => {
    expect(networkError().status).toBe(0)
  })

  it('toApiError envuelve errores desconocidos', () => {
    expect(toApiError(new Error('boom')).message).toBe('boom')
    expect(toApiError('x').status).toBe(0)
    const existing = new ApiError({ status: 404, message: 'x' })
    expect(toApiError(existing)).toBe(existing)
  })
})
