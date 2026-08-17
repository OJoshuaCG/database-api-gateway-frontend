import { describe, expect, it } from 'vitest'
import { ApiError, normalizeApiError } from '@/lib/api/errors'
import {
  EXPORT_ACTION_LABELS,
  EXPORT_PHASE_LABELS,
  EXPORT_PHASE_ORDER,
  classifyExportError,
  exportErrorHint,
  exportItemReasonLabel,
  rowFilterReasonLabel,
  warnAboutUnhandledErrorCodes,
} from './messages'
import type { ExportCapabilities } from '@/lib/contracts'

/** Error del backend tal como llega: el código viaja en `detail.public_context.code`. */
function backendError(status: number, code: string, publicContext: Record<string, unknown> = {}) {
  return normalizeApiError(status, {
    detail: {
      msg: 'Mensaje del backend.',
      type: 'AppHttpException',
      public_context: { code, ...publicContext },
    },
  })
}

describe('classifyExportError', () => {
  it('el código manda sobre el status: tres 409 distintos dan tres acciones distintas', () => {
    expect(classifyExportError(backendError(409, 'export.quota_exceeded'))).toBe('retryLater')
    expect(classifyExportError(backendError(409, 'export.already_executed'))).toBe('startOver')
    expect(classifyExportError(backendError(409, 'export.fingerprint_changed'))).toBe('repreview')
  })

  it('un 422 de combinación incompatible señala un campo, no una acción global', () => {
    expect(classifyExportError(backendError(422, 'export.incompatible_option'))).toBe('fixField')
  })

  it('las dos salidas de los conjuntos se distinguen', () => {
    expect(classifyExportError(backendError(422, 'export.data_without_structure'))).toBe(
      'addToStructure',
    )
    expect(classifyExportError(backendError(422, 'export.missing_dependencies'))).toBe(
      'resolveDependencies',
    )
  })

  it('la entrega en línea que no cabe se resuelve cambiando a archivo, no reintentando', () => {
    expect(classifyExportError(backendError(409, 'export.inline_too_large'))).toBe(
      'switchToFileDelivery',
    )
  })

  it('sin código, un 410 cae a empezar de nuevo (cubre plan y artefacto vencidos)', () => {
    expect(classifyExportError(new ApiError({ status: 410, message: 'Vencido.' }))).toBe(
      'startOver',
    )
  })

  it('sin código, un 429 es esperar', () => {
    expect(classifyExportError(new ApiError({ status: 429, message: 'Demasiadas.' }))).toBe(
      'retryLater',
    )
  })

  it('un código desconocido no se inventa una acción', () => {
    expect(classifyExportError(backendError(409, 'export.futuro_desconocido'))).toBe('none')
  })

  it('el módulo apagado no es un fallo que reintentar', () => {
    expect(classifyExportError(backendError(409, 'export.disabled'))).toBe('moduleDisabled')
  })
})

describe('EXPORT_ACTION_LABELS', () => {
  it('las acciones sin salida concreta no ofrecen botón', () => {
    // Nunca se renderiza un botón que no hace nada: `null` es la señal de "no hay CTA".
    expect(EXPORT_ACTION_LABELS.fixField).toBeNull()
    expect(EXPORT_ACTION_LABELS.retryLater).toBeNull()
    expect(EXPORT_ACTION_LABELS.moduleDisabled).toBeNull()
    expect(EXPORT_ACTION_LABELS.none).toBeNull()
  })

  it('las que sí tienen salida traen etiqueta', () => {
    expect(EXPORT_ACTION_LABELS.repreview).toBeTruthy()
    expect(EXPORT_ACTION_LABELS.startOver).toBeTruthy()
    expect(EXPORT_ACTION_LABELS.switchToFileDelivery).toBeTruthy()
  })
})

describe('ApiError del módulo', () => {
  it('extrae el código y el contexto tipado', () => {
    const error = backendError(422, 'export.incompatible_option', {
      field: 'structure.entity_ddl',
      allowed: ['NONE'],
    })
    expect(error.code).toBe('export.incompatible_option')
    expect(error.exportContext?.field).toBe('structure.entity_ddl')
    expect(error.exportContext?.allowed).toEqual(['NONE'])
  })

  it('las dependencias que faltan llegan como objetos, no como texto plano', () => {
    const error = backendError(422, 'export.missing_dependencies', {
      missing_dependencies: [{ object_type: 'table', name: 'clientes' }],
      suggested_names: ['clientes', 'pedidos'],
    })
    expect(error.exportContext?.missingDependencies).toEqual([
      { objectType: 'table', name: 'clientes' },
    ])
    expect(error.exportContext?.suggestedNames).toEqual(['clientes', 'pedidos'])
  })

  it('no construye contexto de exportación para el error de otro módulo', () => {
    // `field` y `limit` existen en muchos endpoints: sin un código del módulo no son suyos.
    const error = backendError(422, 'grants.invalid', { field: 'algo' })
    expect(error.exportContext).toBeUndefined()
  })

  it('el tope de la entrega en línea llega en números, listo para comparar', () => {
    const error = backendError(409, 'export.inline_too_large', {
      byte_size: 2_380_112,
      inline_max_bytes: 1_048_576,
    })
    expect(error.exportContext?.byteSize).toBe(2_380_112)
    expect(error.exportContext?.inlineMaxBytes).toBe(1_048_576)
  })
})

describe('exportErrorHint', () => {
  it('explica el consumo del artefacto, que el mensaje del backend no cuenta', () => {
    expect(exportErrorHint(backendError(410, 'export.artifact_consumed'))).toContain('una vez')
  })

  it('devuelve null cuando no hay nada que añadir', () => {
    expect(exportErrorHint(backendError(422, 'export.incompatible_option'))).toBeNull()
  })
})

describe('exportItemReasonLabel', () => {
  it('traduce el vocabulario cerrado', () => {
    expect(exportItemReasonLabel('manifest_only')).toContain('manifiesto')
  })

  it('resuelve unsupported_type por prefijo, con el tipo dentro', () => {
    expect(exportItemReasonLabel('unsupported_type:geometry')).toContain('geometry')
  })

  it('un motivo desconocido se muestra tal cual en vez de romper', () => {
    expect(exportItemReasonLabel('motivo_nuevo')).toBe('motivo_nuevo')
  })

  it('sin motivo no hay nada que mostrar', () => {
    expect(exportItemReasonLabel(null)).toBeNull()
  })
})

describe('rowFilterReasonLabel', () => {
  it('interpola el límite real cuando el backend lo manda', () => {
    expect(rowFilterReasonLabel('too_long', 4000)).toContain('4000')
  })

  it('sin límite mantiene el texto genérico', () => {
    expect(rowFilterReasonLabel('too_long')).not.toContain('4000')
  })

  it('cubre los nueve motivos del contrato', () => {
    const reasons = [
      'empty_filter',
      'too_long',
      'unparseable',
      'multiple_statements',
      'not_read_only',
      'subquery_not_allowed',
      'foreign_table_reference',
      'foreign_column_qualifier',
      'comment_not_allowed',
    ]
    for (const reason of reasons) {
      expect(rowFilterReasonLabel(reason)).not.toBe(reason)
    }
  })
})

describe('warnAboutUnhandledErrorCodes', () => {
  it('detecta el código que el backend declara y la UI no traduce', () => {
    const capabilities = {
      error_codes: ['export.incompatible_option', 'export.codigo_nuevo'],
    } as unknown as ExportCapabilities
    expect(warnAboutUnhandledErrorCodes(capabilities)).toEqual(['export.codigo_nuevo'])
  })

  it('con todo cubierto no reporta nada', () => {
    const capabilities = {
      error_codes: ['export.incompatible_option', 'export.quota_exceeded'],
    } as unknown as ExportCapabilities
    expect(warnAboutUnhandledErrorCodes(capabilities)).toEqual([])
  })
})

describe('fases del job', () => {
  it('toda fase del orden tiene etiqueta', () => {
    for (const phase of EXPORT_PHASE_ORDER) {
      expect(EXPORT_PHASE_LABELS[phase]).toBeTruthy()
    }
  })
})
