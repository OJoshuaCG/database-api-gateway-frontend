import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { classifyComparisonError } from './messages'

function error(status: number, message: string): ApiError {
  return new ApiError({ status, message })
}

describe('classifyComparisonError', () => {
  it('410 siempre es recalculate, sin importar el texto', () => {
    expect(classifyComparisonError(error(410, 'cualquier cosa'))).toBe('recalculate')
  })

  it('429 siempre es rateLimited', () => {
    expect(classifyComparisonError(error(429, 'Demasiadas solicitudes.'))).toBe('rateLimited')
  })

  it('reconoce el anti-TOCTOU por su frase estable', () => {
    expect(
      classifyComparisonError(
        error(409, 'El esquema del target cambió desde que se calculó la comparación; recalcúlala.'),
      ),
    ).toBe('recalculate')
  })

  it('reconoce "target con blueprint" (execute bloqueado) → switchToAdopt', () => {
    expect(
      classifyComparisonError(
        error(409, 'El target tiene un blueprint asignado; la ejecución directa está bloqueada.'),
      ),
    ).toBe('switchToAdopt')
  })

  it('reconoce "target sin blueprint" (adopt bloqueado) → switchToExecute', () => {
    expect(
      classifyComparisonError(error(422, 'El target no tiene blueprint asignado; no se puede adoptar.')),
    ).toBe('switchToExecute')
  })

  it('reconoce cuarentena → forceQuarantine', () => {
    expect(
      classifyComparisonError(error(409, 'El target está en cuarentena (status=error); reintenta con ?force=true.')),
    ).toBe('forceQuarantine')
  })

  it('reconoce nombre/token de confirmación no coincidentes', () => {
    expect(
      classifyComparisonError(error(422, 'El nombre de confirmación no coincide con el nombre real.')),
    ).toBe('fixConfirmName')
    expect(
      classifyComparisonError(error(422, 'El token de confirmación no coincide con el conjunto vigente.')),
    ).toBe('recomputeToken')
  })

  it('cae en none cuando el texto no calza con ningún patrón conocido', () => {
    expect(classifyComparisonError(error(422, 'source_database_id y target_database_id deben ser distintos.'))).toBe(
      'none',
    )
  })
})
