import { describe, expect, it } from 'vitest'
import { ApiError, normalizeApiError } from '@/lib/api/errors'
import {
  engineUserErrorDescription,
  engineUserErrorMessage,
  PROTECTION_UNVERIFIABLE_MESSAGE,
} from './engine-user-messages'

/** El 409 tal como lo arma el backend (`db_admin/protected_accounts.py`). */
function protectedAccount(reason?: string): ApiError {
  return normalizeApiError(409, {
    detail: {
      msg: 'texto del backend',
      type: 'AppHttpException',
      public_context: {
        code: 'engine_user.protected_account',
        ...(reason ? { reason } : {}),
      },
    },
  })
}

describe('engineUserErrorMessage', () => {
  it('explica la credencial pseudo-root del gateway como riesgo de auto-bloqueo', () => {
    const message = engineUserErrorMessage(protectedAccount('gateway_credential'))
    expect(message).toContain('pseudo-root del gateway')
    expect(message).toContain('auto-bloqueo')
  })

  it('distingue la cuenta reservada del motor o de la nube administrada', () => {
    expect(engineUserErrorMessage(protectedAccount('reserved_account'))).toContain(
      'cuenta reservada del motor',
    )
  })

  it('distingue el rol con privilegios de administración', () => {
    expect(engineUserErrorMessage(protectedAccount('privileged_role'))).toContain(
      'privilegios de administración del servidor',
    )
  })

  it('un motivo ausente o desconocido sigue diciendo que la cuenta está protegida', () => {
    // Un motivo nuevo del backend no puede caer en `null`: el operador vería el genérico del
    // status («Conflicto…») sin saber que la cuenta está protegida.
    for (const error of [protectedAccount(), protectedAccount('motivo_nuevo')]) {
      expect(engineUserErrorMessage(error)).toContain('protegida')
    }
  })

  it('`protection_unverifiable` invita a reintentar en vez de decir «no se puede»', () => {
    const error = normalizeApiError(409, {
      detail: {
        msg: 'x',
        type: 'AppHttpException',
        public_context: { code: 'engine_user.protection_unverifiable' },
      },
    })
    expect(engineUserErrorMessage(error)).toBe(PROTECTION_UNVERIFIABLE_MESSAGE)
    expect(PROTECTION_UNVERIFIABLE_MESSAGE).toContain('Reintentá')
  })

  it('devuelve null ante otro código, para no ocultar el mensaje real', () => {
    expect(
      engineUserErrorMessage(new ApiError({ status: 409, message: 'x', code: 'otra.cosa' })),
    ).toBeNull()
  })
})

describe('engineUserErrorDescription', () => {
  it('cae en el mensaje del backend cuando el error no es de cuenta protegida', () => {
    expect(engineUserErrorDescription(new ApiError({ status: 502, message: 'motor caído' }))).toBe(
      'motor caído',
    )
  })

  it('usa el copy del guard cuando aplica', () => {
    expect(engineUserErrorDescription(protectedAccount('reserved_account'))).toContain(
      'Gestionala fuera del gateway',
    )
  })
})

describe('engineUserErrorMessage: engine_user.grant_admin_required', () => {
  /** El 403 tal como lo arma el backend (`grant_admin_required` en `engine_user_catalog.py`). */
  function grantAdminRequired(reason?: string): ApiError {
    return normalizeApiError(403, {
      detail: {
        msg: 'texto del backend',
        type: 'AppHttpException',
        public_context: {
          code: 'engine_user.grant_admin_required',
          required_capability: 'engine_users.grant_admin',
          ...(reason ? { reason } : {}),
        },
      },
    })
  }

  it('cada motivo nombra la capacidad y dice qué sí se puede hacer', () => {
    expect(engineUserErrorMessage(grantAdminRequired('with_grant_option'))).toContain(
      'WITH GRANT OPTION',
    )
    expect(engineUserErrorMessage(grantAdminRequired('sensitive_privilege'))).toContain(
      'privilegio sensible',
    )
    expect(engineUserErrorMessage(grantAdminRequired('provision_reassign_owner'))).toContain(
      'propietario',
    )
    for (const reason of ['with_grant_option', 'sensitive_privilege', 'provision_reassign_owner']) {
      expect(engineUserErrorMessage(grantAdminRequired(reason))).toContain(
        'engine_users.grant_admin',
      )
    }
  })

  it('un motivo ausente o desconocido igual nombra la capacidad', () => {
    for (const error of [grantAdminRequired(), grantAdminRequired('motivo_nuevo')]) {
      expect(engineUserErrorMessage(error)).toContain('engine_users.grant_admin')
    }
  })

  it('no es un `access.forbidden`: el 403 con su código propio no se lee como acceso opaco', () => {
    const error = grantAdminRequired('with_grant_option')
    expect(error.status).toBe(403)
    expect(error.code).toBe('engine_user.grant_admin_required')
    expect(error.guardContext?.reason).toBe('with_grant_option')
  })

  it('engineUserErrorDescription usa ese texto en vez del `msg` del backend', () => {
    expect(engineUserErrorDescription(grantAdminRequired('sensitive_privilege'))).toContain(
      'privilegio sensible',
    )
  })
})
