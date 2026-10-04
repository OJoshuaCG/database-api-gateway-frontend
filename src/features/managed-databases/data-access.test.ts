import { describe, expect, it } from 'vitest'
import { normalizeApiError } from '@/lib/api/errors'
import {
  DATA_ACCESS_STATE_BADGE,
  DATA_CREDENTIAL_MAX_AGE_DAYS,
  dataAccessErrorMessage,
  dataCredentialStage,
  dataViolationLabel,
  isDataReadReady,
} from './data-access'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-03T12:00:00Z')

/** Fecha-hora UTC SIN zona, como la manda el backend, `days` días antes de `NOW`. */
function utcDaysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString().slice(0, 19)
}

describe('dataCredentialStage', () => {
  it('sin credencial es `missing`, aunque traiga un verified_at residual', () => {
    expect(
      dataCredentialStage({ has_data_credential: false, verified_at: utcDaysAgo(1) }, NOW),
    ).toBe('missing')
  })

  it('con credencial y sin sonda es `unverified`', () => {
    expect(dataCredentialStage({ has_data_credential: true, verified_at: null }, NOW)).toBe(
      'unverified',
    )
  })

  it('una fecha ilegible no cuenta como verificada (falla cerrado)', () => {
    expect(dataCredentialStage({ has_data_credential: true, verified_at: 'ayer' }, NOW)).toBe(
      'unverified',
    )
  })

  it('verificada hace menos del plazo es `verified`; pasado el plazo, `stale`', () => {
    expect(
      dataCredentialStage(
        { has_data_credential: true, verified_at: utcDaysAgo(DATA_CREDENTIAL_MAX_AGE_DAYS - 1) },
        NOW,
      ),
    ).toBe('verified')
    expect(
      dataCredentialStage(
        { has_data_credential: true, verified_at: utcDaysAgo(DATA_CREDENTIAL_MAX_AGE_DAYS + 1) },
        NOW,
      ),
    ).toBe('stale')
  })

  it('lee el UTC sin zona como UTC y respeta una zona explícita', () => {
    // Sin la `Z` esto se leería en hora local y el borde se movería horas.
    expect(
      dataCredentialStage({ has_data_credential: true, verified_at: '2026-10-03T11:00:00' }, NOW),
    ).toBe('verified')
    expect(
      dataCredentialStage(
        { has_data_credential: true, verified_at: '2026-09-01T00:00:00+00:00' },
        NOW,
      ),
    ).toBe('stale')
  })
})

describe('isDataReadReady', () => {
  const verified = { has_data_credential: true, verified_at: utcDaysAgo(1) }

  it('exige credencial verificada Y acceso abierto', () => {
    expect(isDataReadReady({ ...verified, data_access_state: 'open' }, NOW)).toBe(true)
    expect(isDataReadReady({ ...verified, data_access_state: 'pending' }, NOW)).toBe(false)
    expect(isDataReadReady({ ...verified, data_access_state: 'closed' }, NOW)).toBe(false)
    expect(
      isDataReadReady(
        { has_data_credential: true, verified_at: null, data_access_state: 'open' },
        NOW,
      ),
    ).toBe(false)
  })
})

describe('DATA_ACCESS_STATE_BADGE', () => {
  it('«abierta» va en advertencia: expone filas de un tercero', () => {
    expect(DATA_ACCESS_STATE_BADGE.open.tone).toBe('warning')
    expect(DATA_ACCESS_STATE_BADGE.closed.tone).toBe('neutral')
  })
})

describe('dataViolationLabel', () => {
  it('traduce los motivos propios de la sonda de datos', () => {
    expect(dataViolationLabel('foreign_engine_table')).toMatch(/FEDERATED/)
    expect(dataViolationLabel('select_outside_database')).toMatch(/otras bases/)
    expect(dataViolationLabel('wildcard_database_pattern')).toMatch(/_/)
    expect(dataViolationLabel('extra_privilege:show_view')).toMatch(/SHOW_VIEW/)
  })

  it('reusa los motivos compartidos con la sonda por servidor', () => {
    expect(dataViolationLabel('privilege:insert')).toMatch(/INSERT/)
    expect(dataViolationLabel('grant_option')).toMatch(/GRANT OPTION/)
  })

  it('un motivo desconocido se muestra tal cual', () => {
    expect(dataViolationLabel('motivo_nuevo_del_backend')).toBe('motivo_nuevo_del_backend')
  })
})

describe('dataAccessErrorMessage', () => {
  const errorWith = (status: number, code: string) =>
    normalizeApiError(status, {
      detail: { msg: 'x', type: 'AppHttpException', public_context: { code } },
    })

  it.each([
    ['data_access.self_approval_forbidden', 403, /propio pedido/],
    ['data_access.not_pending', 409, /pendiente/],
    ['data_access.already_open', 409, /ya está abierto/],
    ['data_credential.missing', 409, /no tiene credencial de datos/],
    ['data_credential.account_already_exists', 409, /no creó/],
    ['data_credential.provision_in_progress', 409, /en curso/],
    ['data_credential.database_not_eligible', 409, /no admite credencial de datos/],
    ['managed_database.data_probe_failed', 422, /más que leer/],
  ])('%s tiene su copy', (code, status, pattern) => {
    expect(dataAccessErrorMessage(errorWith(status, code))).toMatch(pattern)
  })

  it('un código ajeno devuelve undefined para que decida el mensaje del backend', () => {
    expect(dataAccessErrorMessage(errorWith(409, 'otro.modulo'))).toBeUndefined()
  })

  it('la sonda de datos expone sus `violations` en el ApiError', () => {
    const error = normalizeApiError(422, {
      detail: {
        msg: 'La credencial de datos no es SELECT-only.',
        type: 'AppHttpException',
        public_context: {
          code: 'managed_database.data_probe_failed',
          reasons: ['WRITE_PRIVILEGE_PRESENT'],
          violations: ['privilege:insert', 'foreign_engine_table', 3],
        },
      },
    })
    expect(error.readonlyProbeViolations).toEqual(['privilege:insert', 'foreign_engine_table'])
  })
})
