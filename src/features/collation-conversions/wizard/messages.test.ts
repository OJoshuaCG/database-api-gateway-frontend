import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { classifyConversionError } from './messages'

function error(status: number, message: string): ApiError {
  return new ApiError({ status, message })
}

function errorWithCode(status: number, message: string, code: string): ApiError {
  return new ApiError({ status, message, code })
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

  // ── Códigos estructurados (v17 §5): tienen prioridad sobre la prosa ──────────────
  //
  // El orden importa y por eso se prueba. Un código es contrato; la prosa no. Mientras los ocho
  // errores viejos del módulo no tengan código conviven los dos mecanismos, y si la prosa ganara
  // se perdería lo único estable que tenemos.

  it('clasifica por código cuando viene uno', () => {
    expect(
      errorWithCode(422, 'texto irrelevante', 'collation.batch_database_set_mismatch'),
    ).toBeInstanceOf(ApiError)
    expect(
      classifyConversionError(
        errorWithCode(422, 'texto irrelevante', 'collation.batch_database_set_mismatch'),
      ),
    ).toBe('replan')
  })

  it('el código GANA sobre la prosa cuando los dos calzan y dicen cosas distintas', () => {
    // Mismo texto que dispara 'forceQuarantine' por expresión regular, pero con un código que
    // dice otra cosa. Si este test se pone rojo, alguien invirtió el orden y la clasificación
    // volvió a depender de una cadena en español.
    const mensajeQueDisparaPatron = 'La base de datos está en cuarentena.'
    expect(classifyConversionError(error(409, mensajeQueDisparaPatron))).toBe('forceQuarantine')
    expect(
      classifyConversionError(
        errorWithCode(409, mensajeQueDisparaPatron, 'collation.batch_not_pending'),
      ),
    ).toBe('replan')
  })

  it('un código de este módulo sin acción asociada cae a la prosa, no a none', () => {
    // `version_too_large` no tiene CTA de recuperación: no está en CODE_ACTIONS. El clasificador
    // no debe cortocircuitar por eso — sigue al fallback como cualquier error sin código.
    expect(
      classifyConversionError(
        errorWithCode(409, 'El job ya está en estado "running".', 'collation.version_too_large'),
      ),
    ).toBe('replan')
  })

  it('410 y 429 siguen ganándole al código: son del transporte, no del dominio', () => {
    expect(
      classifyConversionError(errorWithCode(410, 'expiró', 'collation.batch_not_pending')),
    ).toBe('replan')
    expect(
      classifyConversionError(errorWithCode(429, 'rate limit', 'collation.batch_not_pending')),
    ).toBe('rateLimited')
  })
})
