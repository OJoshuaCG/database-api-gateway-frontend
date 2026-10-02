import { describe, expect, it } from 'vitest'
import { adminOutSchema, CAPABILITIES, type AdminOut } from '@/lib/contracts'
import { needsStepUpPreflight, parseUtcInstant, STEP_UP_PREFLIGHT_MARGIN_MS } from './step-up'

const NOW = Date.parse('2026-10-02T12:00:00Z')

function admin(overrides: Record<string, unknown> = {}): AdminOut {
  return adminOutSchema.parse({
    id: 1,
    username: 'admin',
    step_up_enforced: true,
    step_up_capabilities: [CAPABILITIES.databasesDrop],
    step_up_expires_at: '2026-10-02T12:04:00',
    ...overrides,
  })
}

describe('parseUtcInstant', () => {
  it('lee la fecha SIN zona del backend como UTC, no como hora local', () => {
    expect(parseUtcInstant('2026-10-02T12:05:00')).toBe(Date.parse('2026-10-02T12:05:00Z'))
  })

  it('respeta una zona explícita', () => {
    expect(parseUtcInstant('2026-10-02T09:05:00-03:00')).toBe(Date.parse('2026-10-02T12:05:00Z'))
    expect(parseUtcInstant('2026-10-02T12:05:00Z')).toBe(Date.parse('2026-10-02T12:05:00Z'))
  })

  it('devuelve null sin valor o con basura', () => {
    expect(parseUtcInstant(null)).toBeNull()
    expect(parseUtcInstant(undefined)).toBeNull()
    expect(parseUtcInstant('no-es-fecha')).toBeNull()
  })
})

describe('needsStepUpPreflight', () => {
  it('no pregunta con la ventana holgada', () => {
    expect(needsStepUpPreflight(admin(), CAPABILITIES.databasesDrop, NOW)).toBe(false)
  })

  it('pregunta con menos de un minuto por delante', () => {
    const almost = new Date(NOW + STEP_UP_PREFLIGHT_MARGIN_MS - 1_000).toISOString().slice(0, 19)
    expect(
      needsStepUpPreflight(admin({ step_up_expires_at: almost }), CAPABILITIES.databasesDrop, NOW),
    ).toBe(true)
  })

  it('pregunta con la ventana vencida o sin ventana', () => {
    const past = admin({ step_up_expires_at: '2026-10-02T11:00:00' })
    expect(needsStepUpPreflight(past, CAPABILITIES.databasesDrop, NOW)).toBe(true)
    const none = admin({ step_up_expires_at: null })
    expect(needsStepUpPreflight(none, CAPABILITIES.databasesDrop, NOW)).toBe(true)
  })

  it('no pregunta por una capacidad que no pide step-up', () => {
    const past = admin({ step_up_expires_at: null })
    expect(needsStepUpPreflight(past, CAPABILITIES.databasesRead, NOW)).toBe(false)
  })

  it('no pregunta si el servidor no lo exige (o no lo publica)', () => {
    const off = admin({ step_up_enforced: false, step_up_expires_at: null })
    expect(needsStepUpPreflight(off, CAPABILITIES.databasesDrop, NOW)).toBe(false)
    const legacy = adminOutSchema.parse({
      id: 1,
      username: 'admin',
      step_up_capabilities: [CAPABILITIES.databasesDrop],
    })
    expect(needsStepUpPreflight(legacy, CAPABILITIES.databasesDrop, NOW)).toBe(false)
  })

  it('no pregunta sin sesión en caché', () => {
    expect(needsStepUpPreflight(null, CAPABILITIES.databasesDrop, NOW)).toBe(false)
  })
})
