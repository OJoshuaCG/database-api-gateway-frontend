import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { classifyCloneError } from './messages'

function error(status: number, message: string): ApiError {
  return new ApiError({ status, message })
}

describe('classifyCloneError', () => {
  it('410 siempre es replan, sin importar el texto', () => {
    expect(classifyCloneError(error(410, 'cualquier cosa'))).toBe('replan')
  })

  it('429 siempre es rateLimited', () => {
    expect(classifyCloneError(error(429, 'Demasiadas solicitudes.'))).toBe('rateLimited')
  })

  it('reconoce el plan expirado por su frase estable', () => {
    expect(classifyCloneError(error(410, 'El plan de clonación expiró; vuelve a crearlo.'))).toBe('replan')
  })

  it('reconoce el anti-TOCTOU del origen → replan', () => {
    expect(
      classifyCloneError(error(409, 'El esquema del origen cambió desde que se creó el plan; vuelve a crearlo.')),
    ).toBe('replan')
  })

  it('reconoce el job ya ejecutado → replan', () => {
    expect(
      classifyCloneError(error(409, "El job ya está en estado 'running'; no se puede re-ejecutar.")),
    ).toBe('replan')
  })

  it('reconoce cuarentena → forceQuarantine', () => {
    expect(
      classifyCloneError(error(409, 'El destino está en cuarentena (status=error). Reintenta con force=true.')),
    ).toBe('forceQuarantine')
  })

  it('reconoce nombre/token de confirmación no coincidentes', () => {
    expect(
      classifyCloneError(error(422, 'confirm_target_name no coincide con el nombre de la BD destino.')),
    ).toBe('fixConfirmName')
    expect(
      classifyCloneError(error(422, 'confirm_token no coincide con el plan actual; vuelve a previsualizar.')),
    ).toBe('recomputeToken')
  })

  it('reconoce target_mode=new pero la BD ya existe → switchToExistingTarget', () => {
    expect(
      classifyCloneError(
        error(422, "La BD destino 'productos_copia' ya existe. Usá target_mode='existing'."),
      ),
    ).toBe('switchToExistingTarget')
  })

  it('reconoce target_mode=existing pero la BD no existe → switchToNewTarget', () => {
    expect(
      classifyCloneError(error(404, "La BD destino 'productos_copia' no existe. Usá target_mode='new'.")),
    ).toBe('switchToNewTarget')
  })

  it('cae en none cuando el texto no calza con ningún patrón conocido', () => {
    expect(classifyCloneError(error(422, 'adopt_owner_id debe ser un usuario del servidor destino.'))).toBe(
      'none',
    )
  })
})
