import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { classifyConversionError } from './messages'

function error(status: number, message: string): ApiError {
  return new ApiError({ status, message })
}

describe('classifyConversionError', () => {
  it('410 siempre es replan, sin importar el texto', () => {
    expect(classifyConversionError(error(410, 'El plan expiró.'))).toBe('replan')
  })

  it('429 siempre es rateLimited', () => {
    expect(classifyConversionError(error(429, 'Demasiadas solicitudes.'))).toBe('rateLimited')
  })

  it('reconoce el job ya en otro estado → replan', () => {
    expect(
      classifyConversionError(error(409, "El job ya está en estado 'running'; crea un plan nuevo.")),
    ).toBe('replan')
  })

  it('reconoce el inventario cambiado desde el plan (preview) → forceStaleInventory', () => {
    expect(
      classifyConversionError(
        error(409, 'El inventario de la base de datos cambió desde que se creó el plan.'),
      ),
    ).toBe('forceStaleInventory')
  })

  it('reconoce la cuarentena → forceQuarantine', () => {
    expect(classifyConversionError(error(409, 'La base de datos está en cuarentena.'))).toBe(
      'forceQuarantine',
    )
  })

  it('reconoce el inventario cambiado desde el preview (execute) → forceStaleAtExecute', () => {
    expect(
      classifyConversionError(error(409, 'El inventario de la base de datos cambió desde el preview.')),
    ).toBe('forceStaleAtExecute')
  })

  it('distingue el 409 de preview del de execute por el fragmento final', () => {
    expect(
      classifyConversionError(
        error(409, 'El inventario de la base de datos cambió desde que se creó el plan.'),
      ),
    ).not.toBe(
      classifyConversionError(error(409, 'El inventario de la base de datos cambió desde el preview.')),
    )
  })

  it('reconoce confirm_token no coincidente → recomputeToken', () => {
    expect(
      classifyConversionError(error(422, 'confirm_token no coincide con el plan actual.')),
    ).toBe('recomputeToken')
  })

  it('reconoce confirm_target_name no coincidente → fixConfirmName', () => {
    expect(
      classifyConversionError(
        error(422, 'confirm_target_name no coincide con el nombre de la base de datos.'),
      ),
    ).toBe('fixConfirmName')
  })

  it('reconoce el plan sin pasos → reviewSelection', () => {
    expect(
      classifyConversionError(error(422, 'El plan no tiene ningún paso que ejecutar.')),
    ).toBe('reviewSelection')
  })

  it('reconoce la falta de preview antes de ejecutar → previewFirst', () => {
    expect(
      classifyConversionError(error(409, 'Falta previsualizar el plan antes de ejecutarlo.')),
    ).toBe('previewFirst')
  })

  it('cae en none cuando el texto no calza con ningún patrón conocido', () => {
    expect(classifyConversionError(error(422, 'target_collation es demasiado largo.'))).toBe('none')
  })
})
