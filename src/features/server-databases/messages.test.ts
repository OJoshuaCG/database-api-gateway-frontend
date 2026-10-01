import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { forbiddenCopy } from '@/features/auth'
import {
  DROP_ACTION_HINTS,
  PREVIEW_ACTION_HINTS,
  classifyCreateError,
  classifyDropError,
  classifyPreviewError,
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
