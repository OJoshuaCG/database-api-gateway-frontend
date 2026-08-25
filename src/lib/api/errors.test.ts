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

  it('extrae violations con hint y skipped_tables del context (422 layout manual)', () => {
    const error = normalizeApiError(422, {
      detail: {
        msg: 'El layout manual no es aplicable:\n- …',
        type: 'AppHttpException',
        context: {
          violations: [
            { object: 'monedas', object_type: 'data', version: 0, reason: 'unassigned_data_table', hint: 'Agrega un bucket…' },
          ],
          skipped_tables: [{ table: 'tags', reason: 'no_primary_key' }],
        },
      },
    })
    expect(error.violations?.[0]?.hint).toBe('Agrega un bucket…')
    expect(error.skippedTables).toEqual([{ table: 'tags', reason: 'no_primary_key' }])
  })

  it('extrae missing_down_sql de public_context (409 de rollback)', () => {
    const error = normalizeApiError(409, {
      detail: {
        msg: 'No se puede revertir: las versiones 0008 no tienen rollback confirmado.',
        type: 'AppHttpException',
        public_context: { missing_down_sql: ['0008'] },
      },
    })
    expect(error.missingDownSql).toEqual(['0008'])
  })

  it('no extrae missing_down_sql cuando public_context no lo trae', () => {
    const error = normalizeApiError(409, {
      detail: { msg: 'Conflicto', type: 'AppHttpException' },
    })
    expect(error.missingDownSql).toBeUndefined()
  })

  it('captura el X-Request-ID del tercer argumento', () => {
    expect(normalizeApiError(500, {}, 'req-123').requestId).toBe('req-123')
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

describe('public_context de proyectos y de versiones de blueprint', () => {
  it('extrae `missing_model_ids` del 422 de vinculación (api-reference-v16 §4)', () => {
    const error = normalizeApiError(422, {
      detail: {
        msg: 'Hay blueprints inexistentes en la selección; no se vinculó ninguno: 99, 120',
        type: 'AppHttpException',
        public_context: { code: 'project.blueprints_not_found', missing_model_ids: [99, 120] },
      },
    })
    expect(error.code).toBe('project.blueprints_not_found')
    expect(error.missingModelIds).toEqual([99, 120])
  })

  it('distingue los dos 409 de proyectos por código, no por la prosa', () => {
    const nameTaken = normalizeApiError(409, {
      detail: {
        msg: 'Ya existe un proyecto con ese nombre.',
        type: 'AppHttpException',
        public_context: { code: 'project.name_taken' },
      },
    })
    const linkConflict = normalizeApiError(409, {
      detail: {
        msg: 'Otro proceso vinculó estos blueprints al mismo tiempo; reintentá.',
        type: 'AppHttpException',
        public_context: { code: 'project.link_conflict' },
      },
    })
    // Mismo status, CTAs opuestos: uno se arregla cambiando un dato, el otro repitiendo la
    // llamada. El código es lo único que los separa.
    expect(nameTaken.status).toBe(linkConflict.status)
    expect(nameTaken.code).not.toBe(linkConflict.code)
  })

  it('extrae `blocking_databases` y `override_available` del 409 sql_frozen (v14 §2 / v15 §4)', () => {
    const error = normalizeApiError(409, {
      detail: {
        msg: 'No se puede modificar el SQL: la BD 7 está en la versión 0005…',
        type: 'AppHttpException',
        public_context: {
          code: 'model_migration.sql_frozen',
          version: '0001',
          blocking_databases: [
            { managed_database_id: 7, reason: 'still_applied', current_version: '0005' },
            { managed_database_id: 9, reason: 'unreadable' },
          ],
          override_available: true,
        },
      },
    })
    expect(error.code).toBe('model_migration.sql_frozen')
    expect(error.overrideAvailable).toBe(true)
    expect(error.blockingDatabases).toHaveLength(2)
    expect(error.blockingDatabases?.[0]?.current_version).toBe('0005')
    // `current_version` viaja AUSENTE (no `null`) cuando el motivo no es `still_applied`.
    expect(error.blockingDatabases?.[1]?.current_version).toBeUndefined()
  })

  it('descarta solo las filas malformadas, no la lista entera', () => {
    const error = normalizeApiError(409, {
      detail: {
        msg: 'x',
        type: 'AppHttpException',
        public_context: {
          code: 'model_migration.sql_frozen',
          blocking_databases: [
            { managed_database_id: 7, reason: 'still_applied' },
            { reason: 'still_applied' },
            'basura',
          ],
        },
      },
    })
    // Cada fila es una base que va a quedar divergente: perder la lista completa por un elemento
    // raro dejaría al operador con un 409 sin explicación.
    expect(error.blockingDatabases).toHaveLength(1)
  })

  it('`override_available` ausente NO se interpreta como disponible', () => {
    const error = normalizeApiError(409, {
      detail: {
        msg: 'x',
        type: 'AppHttpException',
        public_context: { code: 'model_migration.sql_frozen' },
      },
    })
    // Un backend anterior a v15 no manda el campo: ahí la única salida sigue siendo fix-forward,
    // y ofrecer la vía de excepción mandaría al operador contra un 409 sin escape.
    expect(error.overrideAvailable).toBeUndefined()
    expect(error.overrideAvailable === true).toBe(false)
  })

  it('los errores del token no traen `code`: se clasifican por status', () => {
    const expired = normalizeApiError(410, {
      detail: { msg: 'El token de confirmación expiró; vuelve a solicitar el preview.', type: 'AppHttpException' },
    })
    const mismatch = normalizeApiError(422, {
      detail: { msg: 'El token de confirmación no corresponde a esta operación.', type: 'AppHttpException' },
    })
    expect(expired.code).toBeUndefined()
    expect(mismatch.code).toBeUndefined()
    expect(expired.status).toBe(410)
    expect(mismatch.status).toBe(422)
  })
})
