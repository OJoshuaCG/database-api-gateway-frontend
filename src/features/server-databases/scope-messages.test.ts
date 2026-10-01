import { describe, expect, it } from 'vitest'
import { ApiError, normalizeApiError } from '@/lib/api/errors'
import {
  engineDatabaseScopeMessage,
  GATEWAY_METADATA_MESSAGE,
  isEngineDatabaseScopeError,
  SYSTEM_DATABASE_FALLBACK,
} from './scope-messages'

const BACKEND_MSG =
  "'mysql' es una base de datos de sistema del motor: no se puede usar como origen ni como destino de esta operación."

/** El 409 tal como lo arma `db_admin/database_scope.py`; `context` solo existe en desarrollo. */
function scopeError(
  publicContext: Record<string, unknown>,
  options: { context?: Record<string, unknown>; msg?: string } = {},
): ApiError {
  return normalizeApiError(409, {
    detail: {
      msg: options.msg ?? BACKEND_MSG,
      type: 'AppHttpException',
      ...(options.context ? { context: options.context } : {}),
      public_context: { code: 'engine_database.scope_not_allowed', ...publicContext },
    },
  })
}

describe('engineDatabaseScopeMessage', () => {
  it('nombra la base de sistema con el nombre que conoce el llamador para ese lado', () => {
    const message = engineDatabaseScopeMessage(
      scopeError({ reason: 'system_database', side: 'target' }),
      { source: 'crm', target: 'sys' },
    )
    expect(message).toContain("'sys' es una base de datos de sistema del motor")
    expect(message).toContain('Revisá la base de destino.')
  })

  it('prefiere el nombre de `context` (desarrollo) al del llamador', () => {
    const message = engineDatabaseScopeMessage(
      scopeError({ reason: 'system_database', side: 'source' }, { context: { database: 'mysql' } }),
      { source: 'otra' },
    )
    expect(message).toContain("'mysql'")
    expect(message).toContain('Revisá la base de origen.')
  })

  it('sin ningún nombre usa el `msg` del backend, que es el único que la nombra', () => {
    expect(engineDatabaseScopeMessage(scopeError({ reason: 'system_database' }))).toBe(BACKEND_MSG)
  })

  it('sin nombre ni envelope del backend cae en el genérico', () => {
    const error = new ApiError({
      status: 409,
      message: 'Conflicto',
      code: 'engine_database.scope_not_allowed',
      guardContext: { reason: 'system_database' },
    })
    expect(engineDatabaseScopeMessage(error)).toBe(SYSTEM_DATABASE_FALLBACK)
  })

  it('la base de metadatos del gateway tiene su propio texto', () => {
    expect(
      engineDatabaseScopeMessage(scopeError({ reason: 'gateway_metadata' }, { msg: 'x' })),
    ).toBe(GATEWAY_METADATA_MESSAGE)
  })

  it('un motivo desconocido sigue diciendo que la base no se puede usar', () => {
    expect(engineDatabaseScopeMessage(scopeError({ reason: 'motivo_nuevo' }))).toContain(
      'no se puede usar como origen ni como destino',
    )
  })

  it('devuelve null ante otro código, para no ocultar el mensaje real', () => {
    const other = new ApiError({ status: 409, message: 'x', code: 'otra.cosa' })
    expect(engineDatabaseScopeMessage(other)).toBeNull()
    expect(isEngineDatabaseScopeError(other)).toBe(false)
    expect(isEngineDatabaseScopeError(null)).toBe(false)
  })
})
