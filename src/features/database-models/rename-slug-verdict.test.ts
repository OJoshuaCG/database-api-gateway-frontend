import { describe, expect, it } from 'vitest'
import { renameSlugPlanSchema, type RenameSlugDatabase, type RenameSlugPlan } from '@/lib/contracts'
import {
  listDatabaseNames,
  planConsequencesChanged,
  renameSlugVerdict,
  verdictAllowsExecution,
} from './rename-slug-verdict'

/** Una fila del plan con lo mínimo; el resto sale de los defaults del schema. */
function row(
  id: number,
  action: RenameSlugDatabase['action'],
  extra: Partial<RenameSlugDatabase> = {},
): RenameSlugDatabase {
  return {
    managed_database_id: id,
    database_name: `tienda_${id}`,
    server_id: 1,
    server_name: 'mysql-prod-1',
    action,
    source_table: null,
    has_mirror: true,
    detail: null,
    ...extra,
  }
}

/** Un plan pasado por el schema real, para que los defaults sean los del contrato. */
function plan(overrides: Record<string, unknown> = {}): RenameSlugPlan {
  return renameSlugPlanSchema.parse({
    model_id: 19,
    current_slug: 'production_db',
    new_slug: 'production_db',
    current_table: '_datum_version_production_db',
    new_table: '_datum_version_production_db',
    mirror_table: '_datum_migrations',
    ...overrides,
  })
}

describe('renameSlugVerdict', () => {
  it('🔴 con un bloqueante, bloquea la operación ENTERA aunque haya bases que renombrar', () => {
    const blocker = row(2, 'conflict')
    const lost = row(3, 'unreachable', { has_mirror: null })
    const verdict = renameSlugVerdict(
      plan({
        databases: [row(1, 'rename', { source_table: '_gw_v_production_db' }), blocker, lost],
        blockers: [blocker, lost],
        rename_count: 1,
        mirror_pending_count: 1,
      }),
      'migrate-format',
    )
    expect(verdict.kind).toBe('blocked')
    if (verdict.kind !== 'blocked') return
    expect(verdict.conflicts.map((r) => r.managed_database_id)).toEqual([2])
    expect(verdict.unreachable.map((r) => r.managed_database_id)).toEqual([3])
    expect(verdictAllowsExecution(verdict)).toBe(false)
  })

  it('🟢 con renames, listo y CON token; las `already` se cuentan aparte', () => {
    const verdict = renameSlugVerdict(
      plan({
        databases: [
          row(1, 'rename', { source_table: '_gw_v_production_db', has_mirror: false }),
          row(2, 'already'),
          row(3, 'already'),
        ],
        rename_count: 1,
        mirror_pending_count: 1,
        requires_confirmation: true,
        confirm_token: 'tok',
        expires_at: '2026-09-21T10:15:00Z',
      }),
      'migrate-format',
    )
    expect(verdict).toMatchObject({
      kind: 'ready',
      renameCount: 1,
      mirrorPendingCount: 1,
      alreadyCount: 2,
      // La base 1 se renombra Y recibe el espejo: es UNA base escrita, no dos.
      writeCount: 1,
      tokenRequired: true,
    })
  })

  it('🔴 solo espejo pendiente: se ejecuta SIN token (no hay que esperarlo)', () => {
    // El backend no emite token con `rename_count: 0`, y aun así vale ejecutar mandando
    // `confirm_token: null`. Bloquear este caso esperando un token dejaría el espejo sin crear.
    const verdict = renameSlugVerdict(
      plan({
        databases: [row(1, 'already', { has_mirror: false }), row(2, 'already')],
        rename_count: 0,
        mirror_pending_count: 1,
        requires_confirmation: false,
        confirm_token: null,
      }),
      'migrate-format',
    )
    expect(verdict).toMatchObject({
      kind: 'ready',
      renameCount: 0,
      mirrorPendingCount: 1,
      writeCount: 1,
      tokenRequired: false,
    })
    expect(verdictAllowsExecution(verdict)).toBe(true)
  })

  it('⚪ todo `already` y sin espejo pendiente: al día, sin nada que ejecutar y sin error', () => {
    const verdict = renameSlugVerdict(
      plan({
        databases: [row(1, 'already'), row(2, 'already'), row(3, 'skip')],
        rename_count: 0,
        mirror_pending_count: 0,
      }),
      'migrate-format',
    )
    expect(verdict).toEqual({ kind: 'up-to-date', alreadyCount: 2, skipCount: 1 })
    expect(verdictAllowsExecution(verdict)).toBe(false)
  })

  it('en `rename-slug`, sin nada remoto el cambio es LOCAL y sí se ejecuta', () => {
    const verdict = renameSlugVerdict(
      plan({ new_slug: 'facturacion', databases: [row(1, 'skip')], rename_count: 0 }),
      'rename-slug',
    )
    expect(verdict).toEqual({ kind: 'local', alreadyCount: 0 })
    expect(verdictAllowsExecution(verdict)).toBe(true)
  })

  it('`no_op` anula `rename_count`: no se pide token aunque el backend cuente bases', () => {
    const verdict = renameSlugVerdict(
      plan({
        new_slug: 'facturacion',
        no_op: true,
        databases: [row(1, 'rename')],
        rename_count: 1,
      }),
      'rename-slug',
    )
    expect(verdict.kind).toBe('local')
  })

  it('el contador del backend es el suelo de las bases escritas si las filas no traen `has_mirror`', () => {
    const verdict = renameSlugVerdict(
      plan({
        databases: [
          row(1, 'already', { has_mirror: null }),
          row(2, 'already', { has_mirror: null }),
        ],
        mirror_pending_count: 2,
      }),
      'migrate-format',
    )
    expect(verdict).toMatchObject({ kind: 'ready', writeCount: 2 })
  })
})

describe('planConsequencesChanged', () => {
  const base = plan({ databases: [row(1, 'rename', { has_mirror: false })], rename_count: 1 })

  it('un plan idéntico no desmarca el reconocimiento', () => {
    expect(planConsequencesChanged(base, plan({ ...base }))).toBe(false)
  })

  it('cambiar si una base necesita el espejo SÍ lo desmarca', () => {
    const next = plan({ ...base, databases: [row(1, 'rename', { has_mirror: true })] })
    expect(planConsequencesChanged(base, next)).toBe(true)
  })

  it('cambiar `mirror_pending_count` SÍ lo desmarca', () => {
    expect(planConsequencesChanged(base, plan({ ...base, mirror_pending_count: 3 }))).toBe(true)
  })
})

describe('listDatabaseNames', () => {
  it('nombra hasta el tope y resume el resto', () => {
    const rows = [1, 2, 3].map((id) => row(id, 'conflict'))
    expect(listDatabaseNames(rows, 2)).toBe('tienda_1, tienda_2 y 1 más')
    expect(listDatabaseNames(rows)).toBe('tienda_1, tienda_2, tienda_3')
  })
})
