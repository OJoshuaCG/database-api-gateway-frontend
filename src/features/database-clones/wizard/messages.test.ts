import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { CLONE_ERROR_CODES, classifyCloneError } from './messages'

function error(status: number, code?: string, message = 'Mensaje del backend.'): ApiError {
  return new ApiError({ status, message, code })
}

describe('classifyCloneError', () => {
  it('410 siempre es replan, venga o no el código', () => {
    expect(classifyCloneError(error(410))).toBe('replan')
    expect(classifyCloneError(error(410, CLONE_ERROR_CODES.planExpired))).toBe('replan')
  })

  it('429 siempre es rateLimited', () => {
    expect(classifyCloneError(error(429))).toBe('rateLimited')
  })

  it.each([
    [CLONE_ERROR_CODES.alreadyExecuted, 409],
    [CLONE_ERROR_CODES.sourceFingerprintChanged, 409],
    [CLONE_ERROR_CODES.targetFingerprintChanged, 409],
  ])('%s → replan: el plan ya no describe la realidad', (code, status) => {
    expect(classifyCloneError(error(status, code))).toBe('replan')
  })

  it('el destino en cuarentena → forceQuarantine', () => {
    expect(classifyCloneError(error(409, CLONE_ERROR_CODES.targetQuarantined))).toBe(
      'forceQuarantine',
    )
  })

  it('nombre y token de confirmación que no coinciden', () => {
    expect(classifyCloneError(error(422, CLONE_ERROR_CODES.confirmNameMismatch))).toBe(
      'fixConfirmName',
    )
    expect(classifyCloneError(error(422, CLONE_ERROR_CODES.tokenMismatch))).toBe('recomputeToken')
  })

  it('el modo de destino equivocado propone el contrario', () => {
    expect(classifyCloneError(error(422, CLONE_ERROR_CODES.targetAlreadyExists))).toBe(
      'switchToExistingTarget',
    )
    expect(classifyCloneError(error(404, CLONE_ERROR_CODES.targetNotFound))).toBe(
      'switchToNewTarget',
    )
  })

  it('ya NO clasifica por la prosa: la frase sin código cae en none', () => {
    // Era el mecanismo anterior. Si vuelve, reescribir un mensaje del backend vuelve a apagar el
    // CTA de recuperación sin que nada falle.
    expect(
      classifyCloneError(error(409, undefined, 'El destino está en cuarentena (status=error).')),
    ).toBe('none')
    expect(classifyCloneError(error(422, undefined, "Usá target_mode='existing'."))).toBe('none')
  })

  it('un código desconocido cae en none (el mensaje lo sigue mostrando ErrorState)', () => {
    expect(classifyCloneError(error(422, 'clone.owner_invalid'))).toBe('none')
    expect(classifyCloneError(error(422, 'clone.algo_que_todavia_no_existe'))).toBe('none')
    expect(classifyCloneError(error(422, 'constructor'))).toBe('none')
  })
})
