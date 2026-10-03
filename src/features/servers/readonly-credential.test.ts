import { describe, expect, it } from 'vitest'
import { normalizeApiError } from '@/lib/api/errors'
import {
  READONLY_MAX_AGE_DAYS,
  isReadonlyUsable,
  readonlyCredentialErrorMessage,
  readonlyCredentialState,
  readonlyViolationLabel,
} from './readonly-credential'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-02T12:00:00Z')

describe('readonlyCredentialState', () => {
  it('sin credencial es `missing`, aunque llegue una fecha suelta', () => {
    expect(
      readonlyCredentialState(
        { has_readonly_credential: false, readonly_verified_at: '2026-10-01T00:00:00' },
        NOW,
      ),
    ).toBe('missing')
  })

  it('un backend anterior a v30 (campos ausentes) se lee como `missing`', () => {
    expect(readonlyCredentialState({}, NOW)).toBe('missing')
  })

  it('con credencial y sin fecha es `unverified`', () => {
    expect(
      readonlyCredentialState({ has_readonly_credential: true, readonly_verified_at: null }, NOW),
    ).toBe('unverified')
  })

  it('verificada dentro del plazo es `verified` y el MCP la puede usar', () => {
    const state = readonlyCredentialState(
      { has_readonly_credential: true, readonly_verified_at: '2026-09-30T12:00:00' },
      NOW,
    )
    expect(state).toBe('verified')
    expect(isReadonlyUsable(state)).toBe(true)
  })

  it(`pasados ${READONLY_MAX_AGE_DAYS} días es \`stale\` y el MCP no la usa`, () => {
    const verifiedAt = new Date(NOW - (READONLY_MAX_AGE_DAYS + 1) * DAY_MS)
      .toISOString()
      .slice(0, 19)
    const state = readonlyCredentialState(
      { has_readonly_credential: true, readonly_verified_at: verifiedAt },
      NOW,
    )
    expect(state).toBe('stale')
    expect(isReadonlyUsable(state)).toBe(false)
  })

  it('lee la fecha sin zona como UTC, no como hora local', () => {
    // Justo en el borde: 30 días exactos en UTC siguen vigentes. Un navegador al este de UTC que
    // la leyera como hora local la vería unas horas más vieja y la daría por vencida.
    const borde = new Date(NOW - READONLY_MAX_AGE_DAYS * DAY_MS).toISOString().slice(0, 19)
    expect(
      readonlyCredentialState({ has_readonly_credential: true, readonly_verified_at: borde }, NOW),
    ).toBe('verified')
  })

  it('una fecha ilegible no se toma como verificada', () => {
    expect(
      readonlyCredentialState({ has_readonly_credential: true, readonly_verified_at: 'ayer' }, NOW),
    ).toBe('unverified')
  })
})

describe('readonlyViolationLabel', () => {
  it('traduce los motivos fijos', () => {
    expect(readonlyViolationLabel('grant_option')).toMatch(/GRANT OPTION/)
    expect(readonlyViolationLabel('write_attempt_succeeded')).toMatch(/intentó escribir/)
  })

  it('resuelve los motivos con sufijo por prefijo', () => {
    expect(readonlyViolationLabel('privilege:insert')).toBe('Tiene el privilegio INSERT.')
    expect(readonlyViolationLabel('global_privilege:select')).toMatch(/SELECT a nivel global/)
    expect(readonlyViolationLabel('role_attribute:rolsuper')).toMatch(/ROLSUPER/)
    expect(readonlyViolationLabel('member_of:pg_write_all_data')).toMatch(/pg_write_all_data/)
  })

  it('un motivo desconocido se muestra tal cual, no se pierde', () => {
    expect(readonlyViolationLabel('motivo_nuevo_del_backend')).toBe('motivo_nuevo_del_backend')
    expect(readonlyViolationLabel('privilege:')).toBe('privilege:')
  })
})

describe('extracción de `violations` en el ApiError', () => {
  it('lee `public_context.violations` del 422 `server.readonly_probe_failed`', () => {
    const error = normalizeApiError(422, {
      detail: {
        msg: 'La credencial de solo lectura tiene privilegios de escritura o de más.',
        type: 'AppHttpException',
        public_context: {
          code: 'server.readonly_probe_failed',
          violations: ['privilege:insert', 'grant_option', 7],
        },
      },
    })
    expect(error.readonlyProbeViolations).toEqual(['privilege:insert', 'grant_option'])
    expect(readonlyCredentialErrorMessage(error)).toMatch(/puede escribir/)
  })

  it('no toma `violations` de un error de otro código', () => {
    const error = normalizeApiError(422, {
      detail: {
        msg: 'otra cosa',
        type: 'AppHttpException',
        public_context: { code: 'otro.modulo', violations: ['privilege:insert'] },
      },
    })
    expect(error.readonlyProbeViolations).toBeUndefined()
    expect(readonlyCredentialErrorMessage(error)).toBeUndefined()
  })

  it('el 409 sin credencial tiene su propio mensaje', () => {
    const error = normalizeApiError(409, {
      detail: {
        msg: 'sin credencial',
        type: 'AppHttpException',
        public_context: { code: 'server.readonly_credential_missing' },
      },
    })
    expect(readonlyCredentialErrorMessage(error)).toMatch(/no tiene credencial/)
  })

  it('el 409 de cuenta protegida y el 429 tienen mensaje propio', () => {
    const protectedError = normalizeApiError(409, {
      detail: {
        msg: 'protegida',
        type: 'AppHttpException',
        public_context: { code: 'engine_user.protected_account', reason: 'privileged_role' },
      },
    })
    expect(readonlyCredentialErrorMessage(protectedError)).toMatch(/configurado en el gateway/)
    const limited = normalizeApiError(429, { detail: { msg: 'rate', type: 'RateLimit' } })
    expect(readonlyCredentialErrorMessage(limited)).toMatch(/Esperá un minuto/)
  })
})
