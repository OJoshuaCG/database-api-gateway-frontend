import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { csrfErrorCopy, forbiddenCopy } from '@/features/auth'
import { AUTH_CSRF_ERROR_CODES } from '@/lib/contracts'
import {
  DROP_ACTION_HINTS,
  DROP_ACTION_LABELS,
  PREVIEW_ACTION_HINTS,
  classifyCreateError,
  classifyDropError,
  classifyPreviewError,
  dropErrorHint,
} from './messages'

const forbidden = new ApiError({ status: 403, message: 'No.', code: 'access.forbidden' })
const engine403 = new ApiError({ status: 403, message: 'Access denied for user' })

describe('403 de acceso del gateway vs. 403 del motor', () => {
  it('en el alta, el de acceso usa el copy compartido y el del motor conserva el suyo', () => {
    expect(classifyCreateError(forbidden).hint).toBe(forbiddenCopy().body)
    expect(classifyCreateError(engine403).hint).toContain('credencial del gateway')
  })

  it('en el borrado y su preview, el de acceso es terminal propio y nunca ofrece reintentar', () => {
    expect(classifyDropError(forbidden)).toBe('forbidden')
    expect(DROP_ACTION_HINTS.forbidden).toBe(forbiddenCopy().body)
    // Antes un 403 del preview caía en «Reintentar preview».
    expect(classifyPreviewError(forbidden)).toBe('forbidden')
    expect(PREVIEW_ACTION_HINTS.forbidden).toBe(forbiddenCopy().body)
    expect(classifyDropError(engine403)).toBe('terminal')
  })
})

describe('403 de CSRF', () => {
  const csrf = new ApiError({
    status: 403,
    message: 'Token CSRF inválido.',
    code: AUTH_CSRF_ERROR_CODES.invalid,
  })
  const origin = new ApiError({
    status: 403,
    message: 'Origen no permitido para esta operación.',
    code: AUTH_CSRF_ERROR_CODES.originRejected,
  })

  it('en el alta no culpa a la credencial del gateway ni al acceso de la persona', () => {
    const hint = classifyCreateError(csrf).hint
    expect(hint).toBe(csrfErrorCopy(csrf))
    expect(hint).not.toContain('credencial del gateway')
    expect(hint).not.toBe(forbiddenCopy().body)
  })

  it('en el borrado es su propia acción, con la pista según el código y sin botón', () => {
    expect(classifyDropError(csrf)).toBe('csrf')
    expect(classifyDropError(origin)).toBe('csrf')
    expect(dropErrorHint('csrf', csrf)).toBe(csrfErrorCopy(csrf))
    expect(dropErrorHint('csrf', origin)).toBe(csrfErrorCopy(origin))
    expect(DROP_ACTION_LABELS.csrf).toBeNull()
  })

  it('las demás acciones de borrado conservan su pista', () => {
    expect(dropErrorHint('forbidden', forbidden)).toBe(DROP_ACTION_HINTS.forbidden)
  })
})
