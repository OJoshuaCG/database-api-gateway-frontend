import { describe, expect, it } from 'vitest'
import { describeSkippedReason, describeViolation, violationTarget } from './messages'

describe('describeSkippedReason', () => {
  it('mapea motivos conocidos a texto accionable', () => {
    expect(describeSkippedReason('no_primary_key')).toMatch(/clave primaria/i)
    expect(describeSkippedReason('oversize_bytes')).toMatch(/bytes/i)
  })

  it('extrae el tipo del sufijo dinámico unsupported_type', () => {
    expect(describeSkippedReason('unsupported_type:UUID')).toMatch(/\(UUID\)/)
  })

  it('devuelve el motivo crudo si es desconocido', () => {
    expect(describeSkippedReason('algo_raro')).toBe('algo_raro')
  })
})

describe('describeViolation', () => {
  it('incorpora los campos extra según el reason', () => {
    expect(describeViolation({ reason: 'duplicate_assignment', also_in_version: 2 })).toMatch(/v2/)
    expect(
      describeViolation({ reason: 'dependency_in_later_version', depends_on: 'clientes', dependency_version: 3 }),
    ).toMatch(/clientes.*v3/)
    expect(describeViolation({ reason: 'schema_after_data', first_data_version: 4 })).toMatch(/v4/)
  })

  it('cae al reason crudo si es desconocido', () => {
    expect(describeViolation({ reason: 'mistério' })).toBe('mistério')
  })
})

describe('violationTarget', () => {
  it('ancla la versión y el objeto', () => {
    expect(violationTarget({ reason: 'x', version: 2, object: 'clientes' })).toBe('v2 · clientes')
    expect(violationTarget({ reason: 'x' })).toBeUndefined()
  })
})
