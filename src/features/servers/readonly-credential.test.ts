import { describe, expect, it } from 'vitest'
import { normalizeApiError } from '@/lib/api/errors'
import {
  READONLY_MAX_AGE_DAYS,
  isReadonlyUsable,
  procGrantOutcome,
  readonlyCredentialErrorMessage,
  readonlyCredentialState,
  readonlyProcGrantErrorMessage,
  readonlyViolationLabel,
  showsProcGrantControl,
} from './readonly-credential'
import {
  READONLY_PROC_ACK_TEXT,
  readonlyProcGrantOutSchema,
  serverOutSchema,
} from '@/lib/contracts'

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

describe('showsProcGrantControl', () => {
  it('ofrece el control a la familia MySQL/MariaDB aunque no se conozca la versión', () => {
    expect(showsProcGrantControl({ engine: 'mysql' })).toBe(true)
    expect(showsProcGrantControl({ engine: 'mariadb' })).toBe(true)
  })

  it('PostgreSQL no tiene mysql.proc: sin bandera no hay control', () => {
    expect(showsProcGrantControl({ engine: 'postgresql' })).toBe(false)
    expect(showsProcGrantControl({ engine: 'postgresql', readonly_proc_grant: false })).toBe(false)
  })

  it('con la bandera encendida se muestra siempre, para poder apagarla', () => {
    expect(showsProcGrantControl({ engine: 'postgresql', readonly_proc_grant: true })).toBe(true)
  })
})

describe('procGrantOutcome', () => {
  it('converged es éxito y dice que la sonda pasó', () => {
    const outcome = procGrantOutcome('converged', true)
    expect(outcome.tone).toBe('success')
    expect(outcome.description).toMatch(/la sonda pasó/)
  })

  it('not_alterable avisa que el gateway no tocó los grants y que el servidor queda sin verificar', () => {
    const enabling = procGrantOutcome('not_alterable', true)
    expect(enabling.tone).toBe('warning')
    expect(enabling.description).toMatch(/agregale SELECT ON mysql\.proc/)
    expect(enabling.description).toMatch(/sin verificar/)
    expect(procGrantOutcome('not_alterable', false).description).toMatch(/quitale SELECT ON/)
  })

  it('no_credential avisa que solo cambió la bandera', () => {
    const outcome = procGrantOutcome('no_credential', false)
    expect(outcome.tone).toBe('success')
    expect(outcome.title).toMatch(/deshabilitada/)
    expect(outcome.description).toMatch(/solo cambió la bandera/)
  })
})

describe('readonlyProcGrantErrorMessage', () => {
  function error422(code: string) {
    return normalizeApiError(422, {
      detail: { msg: 'x', type: 'AppHttpException', public_context: { code } },
    })
  }

  it('traduce los dos 422 cerrados y los deja sin efecto', () => {
    expect(
      readonlyProcGrantErrorMessage(error422('server.readonly_proc_grant.engine_unsupported')),
    ).toMatch(/no necesita ni admite SELECT ON mysql\.proc/)
    expect(
      readonlyProcGrantErrorMessage(error422('server.readonly_proc_grant.ack_mismatch')),
    ).toMatch(/aceptar el aviso completo/)
  })

  it('el 409 de aprovisionamiento en curso y el 429 tienen mensaje propio', () => {
    const inProgress = normalizeApiError(409, {
      detail: {
        msg: 'x',
        type: 'AppHttpException',
        public_context: { code: 'readonly_provision.in_progress' },
      },
    })
    expect(readonlyProcGrantErrorMessage(inProgress)).toMatch(/en curso/)
    const limited = normalizeApiError(429, { detail: { msg: 'rate', type: 'RateLimit' } })
    expect(readonlyProcGrantErrorMessage(limited)).toMatch(/Esperá un minuto/)
  })

  it('un error de otra clase no se traduce', () => {
    expect(readonlyProcGrantErrorMessage(error422('otro.modulo'))).toBeUndefined()
  })
})

describe('contrato de readonly-credential/routine-bodies', () => {
  it('ServerOut sin readonly_proc_grant (backend anterior) sigue siendo válido', () => {
    const parsed = serverOutSchema.parse({
      id: 1,
      name: 's',
      host: 'h',
      port: 3306,
      engine: 'mysql',
      root_username: 'r',
      status: 'active',
      is_active: true,
      has_root_password: true,
      created_at: '2026-01-01T00:00:00',
      updated_at: '2026-01-01T00:00:00',
    })
    expect(parsed.readonly_proc_grant).toBeUndefined()
  })

  it('lee los tres estados de engine_grant y rechaza uno fuera del vocabulario', () => {
    const server = {
      id: 1,
      name: 's',
      host: 'h',
      port: 3306,
      engine: 'mariadb',
      root_username: 'r',
      status: 'active',
      is_active: true,
      has_root_password: true,
      readonly_proc_grant: true,
      created_at: '2026-01-01T00:00:00',
      updated_at: '2026-01-01T00:00:00',
    }
    for (const state of ['converged', 'not_alterable', 'no_credential']) {
      expect(readonlyProcGrantOutSchema.parse({ server, engine_grant: state }).engine_grant).toBe(
        state,
      )
    }
    expect(() => readonlyProcGrantOutSchema.parse({ server, engine_grant: 'maybe' })).toThrow()
  })

  it('el texto de acknowledgement es el literal del backend', () => {
    // Copia literal de READONLY_PROC_ACK_TEXT (app/services/server_catalog.py): el backend lo
    // compara carácter por carácter, así que cualquier diferencia rompe la habilitación.
    expect(READONLY_PROC_ACK_TEXT).toBe(
      'Entiendo que SELECT ON mysql.proc es server-wide: expone el código de las rutinas de TODAS las bases de datos de este servidor, incluidas las que están fuera del proyecto o excluidas, y que solo el filtrado del gateway lo contiene.',
    )
  })
})
