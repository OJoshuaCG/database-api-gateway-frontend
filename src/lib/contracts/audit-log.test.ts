import { describe, expect, it } from 'vitest'
import { auditLogEntrySchema } from './audit-log'
import { CAPABILITIES } from './auth'

const BASE_ENTRY = {
  id: 1,
  created_at: '2026-10-03T10:00:00',
  actor_type: 'admin',
  action: 'query_console.execute',
  touched_engine: true,
  status: 'attempt',
}

describe('capacidades de la partición de policy.admin', () => {
  it('auditRead y cryptoRotate existen con el valor del catálogo y policyAdmin ya no', () => {
    expect(CAPABILITIES.auditRead).toBe('audit.read')
    expect(CAPABILITIES.cryptoRotate).toBe('crypto.rotate')
    expect('policyAdmin' in CAPABILITIES).toBe(false)
    expect(Object.values(CAPABILITIES)).not.toContain('policy.admin')
  })
})

describe('auditLogEntrySchema.detail_masked', () => {
  it('es falso cuando el backend no lo manda (backend anterior)', () => {
    expect(auditLogEntrySchema.parse(BASE_ENTRY).detail_masked).toBeFalsy()
  })

  it('es falso cuando viene nulo', () => {
    expect(
      auditLogEntrySchema.parse({ ...BASE_ENTRY, detail_masked: null }).detail_masked,
    ).toBeFalsy()
  })

  it('respeta true cuando el servidor enmascaró el SQL', () => {
    expect(auditLogEntrySchema.parse({ ...BASE_ENTRY, detail_masked: true }).detail_masked).toBe(
      true,
    )
  })
})
