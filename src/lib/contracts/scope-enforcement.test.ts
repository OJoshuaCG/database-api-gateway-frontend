import { describe, expect, it } from 'vitest'
import { CAPABILITIES, scopeReadinessSchema } from './auth'
import { cloneBatchOutSchema } from './clone-batches'
import { collationBatchDatabaseOutSchema } from './collation-conversions'

/** Forma de los contratos que `scope-enforcement-hardening` cambió en el backend. */

describe('scope-readiness: F-17', () => {
  const base = { total_databases: 3, unclassified_databases: 0, ready: true }

  it('lee `server_resolution_inventory_only`', () => {
    expect(
      scopeReadinessSchema.parse({ ...base, server_resolution_inventory_only: true })
        .server_resolution_inventory_only,
    ).toBe(true)
  })

  it('un backend anterior (sin el campo) no rompe: cae a false', () => {
    expect(scopeReadinessSchema.parse(base).server_resolution_inventory_only).toBe(false)
  })
})

describe('capacidades', () => {
  it('incluye environments.write, engine_users.credentials y la partición de gateway.admin (36 en total)', () => {
    expect(CAPABILITIES.environmentsWrite).toBe('environments.write')
    expect(CAPABILITIES.engineUsersCredentials).toBe('engine_users.credentials')
    expect(CAPABILITIES.accessAdmin).toBe('access.admin')
    expect(CAPABILITIES.policyAdmin).toBe('policy.admin')
    expect(Object.values(CAPABILITIES)).not.toContain('gateway.admin')
    expect(Object.keys(CAPABILITIES)).toHaveLength(36)
  })
})

describe('collation batch: BD omitida por scope', () => {
  it('acepta server_id, database_name, batch_seq y job_id en null', () => {
    const parsed = collationBatchDatabaseOutSchema.parse({
      managed_database_id: 9,
      server_id: null,
      database_name: null,
      batch_seq: null,
      job_id: null,
      ok: false,
      error: null,
      error_code: 'access.forbidden',
      tables_to_convert: 0,
      objects_to_recreate: 0,
      include_database_default: true,
      missing_tables: [],
      warnings: [],
      confirm_token: null,
    })
    expect(parsed.database_name).toBeNull()
  })
})

describe('clone batch: skipped', () => {
  const batch = {
    id: 1,
    source_server_id: 1,
    target_server_id: 2,
    copy_intent: 'structure_and_data',
    total: 2,
    confirm_token: 't',
    status: 'running',
    cancel_requested: false,
    counts: { total: 2 },
    created_at: '2026-10-01T10:00:00Z',
    expires_at: '2026-10-02T10:00:00Z',
  }

  it('lee las filas omitidas de execute / retry-failed', () => {
    const parsed = cloneBatchOutSchema.parse({
      ...batch,
      skipped: [{ id: 12, ok: false, error_code: 'access.forbidden' }],
    })
    expect(parsed.skipped).toEqual([{ id: 12, ok: false, error_code: 'access.forbidden' }])
  })

  it('sin el campo (cualquier otro endpoint) es una lista vacía', () => {
    expect(cloneBatchOutSchema.parse(batch).skipped).toEqual([])
    expect(cloneBatchOutSchema.parse({ ...batch, skipped: null }).skipped).toEqual([])
  })
})
