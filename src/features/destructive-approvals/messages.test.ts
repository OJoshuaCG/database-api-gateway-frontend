import { describe, expect, it } from 'vitest'
import { normalizeApiError } from '@/lib/api/errors'
import { DESTRUCTIVE_APPROVAL_ERROR_CODES, SELF_APPROVAL_FORBIDDEN_CODE } from '@/lib/contracts'
import {
  approvalStatusLabel,
  destructiveApprovalMessage,
  destructiveBlockedMessage,
  requiresNewDryRun,
} from './messages'

describe('destructiveApprovalMessage', () => {
  it('traduce cada código del vocabulario cerrado, sin texto del servidor', () => {
    for (const code of Object.values(DESTRUCTIVE_APPROVAL_ERROR_CODES)) {
      const message = destructiveApprovalMessage(code)
      expect(message, code).toBeTruthy()
      expect(message).not.toMatch(/Traceback|SQLSTATE|mysql|postgres/i)
    }
  })

  it('S40: la autoaprobación dice que otra persona debe aprobar y nombra la regla', () => {
    const creator = destructiveApprovalMessage(SELF_APPROVAL_FORBIDDEN_CODE, 'creator')
    const editor = destructiveApprovalMessage(SELF_APPROVAL_FORBIDDEN_CODE, 'last_editor')
    const unknown = destructiveApprovalMessage(SELF_APPROVAL_FORBIDDEN_CODE, undefined)

    expect(creator).toMatch(/Creaste esta versión/)
    expect(creator).toMatch(/otra persona debe aprobarla/)
    expect(editor).toMatch(/editó por última vez/)
    expect(editor).toMatch(/otra persona debe aprobarla/)
    // Sin `rule` (o con una desconocida) igual se explica, sin inventar quién fue.
    expect(unknown).toMatch(/otra persona debe aprobarla/)
  })

  it('devuelve null para un código que no es de este flujo', () => {
    expect(destructiveApprovalMessage('environment.not_found')).toBeNull()
    expect(destructiveApprovalMessage(undefined)).toBeNull()
  })
})

describe('requiresNewDryRun', () => {
  it('S39: un token vencido, inválido o ausente pide planificar de nuevo', () => {
    expect(requiresNewDryRun(DESTRUCTIVE_APPROVAL_ERROR_CODES.confirmationExpired)).toBe(true)
    expect(requiresNewDryRun(DESTRUCTIVE_APPROVAL_ERROR_CODES.confirmationInvalid)).toBe(true)
    expect(requiresNewDryRun(DESTRUCTIVE_APPROVAL_ERROR_CODES.confirmationRequired)).toBe(true)
  })

  it('un nombre mal re-tipeado no obliga a planificar de nuevo', () => {
    expect(requiresNewDryRun(DESTRUCTIVE_APPROVAL_ERROR_CODES.confirmPhraseMismatch)).toBe(false)
  })
})

describe('destructiveBlockedMessage', () => {
  it('en `down` aclara que la aprobación del apply no cubre el rollback', () => {
    expect(destructiveBlockedMessage('down', ['0003'])).toMatch(/no lo cubre/)
    expect(destructiveBlockedMessage('down', ['0003'])).toMatch(/0003/)
  })

  it('en `up` habla de segunda persona', () => {
    expect(destructiveBlockedMessage('up', [])).toMatch(/segunda persona/)
  })
})

describe('approvalStatusLabel', () => {
  it('degrada a texto crudo con un estado que esta SPA no conoce', () => {
    expect(approvalStatusLabel('approved')).toBe('Aprobada')
    expect(approvalStatusLabel('algo_nuevo')).toBe('algo_nuevo')
  })
})

describe('contexto del ApiError', () => {
  it('extrae la regla de cuatro ojos y la dirección del bloqueo', () => {
    const selfApproval = normalizeApiError(409, {
      detail: {
        msg: 'x',
        type: 'AppHttpException',
        public_context: { code: SELF_APPROVAL_FORBIDDEN_CODE, rule: 'last_editor' },
      },
    })
    expect(selfApproval.code).toBe(SELF_APPROVAL_FORBIDDEN_CODE)
    expect(selfApproval.selfApprovalRule).toBe('last_editor')

    const blocked = normalizeApiError(409, {
      detail: {
        msg: 'x',
        type: 'AppHttpException',
        public_context: {
          code: 'environment.destructive_blocked',
          environment_slug: 'production',
          direction: 'down',
          blocked_versions: ['0004'],
          approved_versions: ['0003'],
        },
      },
    })
    expect(blocked.environmentContext).toMatchObject({
      environmentSlug: 'production',
      direction: 'down',
      blockedVersions: ['0004'],
      approvedVersions: ['0003'],
    })
  })
})
