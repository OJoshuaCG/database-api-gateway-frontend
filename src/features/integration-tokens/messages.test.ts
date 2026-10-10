import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import {
  DESTRUCTIVE_ACKNOWLEDGEMENT_LABEL,
  RATE_LIMIT_HINT,
  destructiveWarning,
  integrationTokenErrorMessage,
} from './messages'

function apiError(status: number, code: string, maxDays?: number): ApiError {
  return new ApiError({
    status,
    message: 'mensaje del servidor',
    code,
    apiTokenContext: maxDays === undefined ? undefined : { maxDays },
  })
}

describe('destructiveWarning', () => {
  it('interpola el tope que informa el servidor y conserva las condiciones del tier', () => {
    const text = destructiveWarning(7)
    expect(text).toContain('El token vencerá en 7 días como máximo')
    expect(text).toContain('revertir migraciones')
    expect(text).toContain('exige una lista de blueprints')
    expect(text).toContain('ni en bases sin entorno')
  })

  it('la confirmación dice qué se acepta', () => {
    expect(DESTRUCTIVE_ACKNOWLEDGEMENT_LABEL).toBe(
      'Entiendo que una integración podrá revertir migraciones y perder datos.',
    )
  })
})

describe('integrationTokenErrorMessage', () => {
  it('un 429 explica el límite del alta', () => {
    expect(integrationTokenErrorMessage(apiError(429, 'x'))).toBe(RATE_LIMIT_HINT)
  })

  it('ttl_too_long muestra el max_days real del servidor', () => {
    const message = integrationTokenErrorMessage(apiError(422, 'integration_token.ttl_too_long', 7))
    expect(message).toContain('7 días')
  })

  it('reconoce el kill switch y la lista de blueprints obligatoria', () => {
    expect(integrationTokenErrorMessage(apiError(503, 'integration.disabled'))).toContain('apagada')
    expect(
      integrationTokenErrorMessage(apiError(422, 'integration_token.blueprint_allowlist_required')),
    ).toContain('blueprint')
  })

  it('un código desconocido devuelve null para caer en el mensaje del servidor', () => {
    expect(integrationTokenErrorMessage(apiError(500, 'otra.cosa'))).toBeNull()
  })
})
