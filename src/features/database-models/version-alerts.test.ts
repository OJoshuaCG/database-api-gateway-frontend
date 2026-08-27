import { describe, expect, it } from 'vitest'
import type { ModelMigrationSummary } from '@/lib/contracts'
import { hasVersionAlerts, versionAlerts } from './version-alerts'

function summary(overrides: Partial<ModelMigrationSummary> = {}): ModelMigrationSummary {
  return {
    id: 1,
    model_id: 3,
    version: '0001',
    name: 'Esquema inicial',
    has_mysql_override: false,
    has_postgresql_override: false,
    has_rollback: true,
    capture_selects: false,
    sql_frozen: false,
    deletable: true,
    block_reason: null,
    sql_diverged: false,
    has_seed: false,
    forced_collations: [],
    destructive: false,
    checksum: 'abc123',
    created_at: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

describe('versionAlerts', () => {
  it('reparte cada versión en los cubos que le corresponden', () => {
    const alerts = versionAlerts([
      summary({ version: '0001', has_rollback: false }),
      summary({ version: '0002', reviewed: false }),
      summary({ version: '0003', sql_diverged: true, sql_frozen: true }),
    ])

    expect(alerts.withoutRollback).toEqual(['0001'])
    expect(alerts.unreviewed).toEqual(['0002'])
    expect(alerts.diverged).toEqual(['0003'])
    expect(alerts.frozen).toEqual(['0003'])
  })

  it('una versión puede caer en varios cubos a la vez', () => {
    const alerts = versionAlerts([summary({ version: '0007', reviewed: false, has_rollback: false })])
    expect(alerts.unreviewed).toEqual(['0007'])
    expect(alerts.withoutRollback).toEqual(['0007'])
  })

  it('`reviewed` ausente NO cuenta como sin revisar', () => {
    // El campo es opcional en el contrato: un backend que no lo mande no está diciendo que la
    // versión esté sin revisar. Mismo criterio estricto que `blockedByReview` en `capture.ts`,
    // porque este cubo describe un rechazo real del backend, no un aviso preventivo.
    const alerts = versionAlerts([summary({ version: '0001' })])
    expect(alerts.unreviewed).toEqual([])
  })

  it('conserva el orden de entrada, que es el del desplegable', () => {
    // Un aviso que liste «0007, 0003, 0011» se lee como si el orden significara algo.
    const alerts = versionAlerts([
      summary({ version: '0002', has_rollback: false }),
      summary({ version: '0009', has_rollback: false }),
      summary({ version: '0010', has_rollback: false }),
    ])
    expect(alerts.withoutRollback).toEqual(['0002', '0009', '0010'])
  })

  it('un catálogo vacío no produce avisos', () => {
    expect(hasVersionAlerts(versionAlerts([]))).toBe(false)
  })

  it('un catálogo enteramente sano tampoco', () => {
    expect(hasVersionAlerts(versionAlerts([summary({ reviewed: true })]))).toBe(false)
  })

  it('con un solo aviso, la barra se muestra', () => {
    expect(hasVersionAlerts(versionAlerts([summary({ has_rollback: false })]))).toBe(true)
  })
})
