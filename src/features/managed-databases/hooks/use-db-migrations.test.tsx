import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { isDryRunResult } from '@/lib/contracts'
import {
  useApplyMigrations,
  useMigrationStatus,
  useReconcilePartial,
  useReconcilePreview,
  useStampMigration,
} from './use-db-migrations'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

describe('useMigrationStatus', () => {
  it('expone la versión actual y las pendientes', async () => {
    server.use(
      http.get('http://localhost/api/v1/managed-databases/5/migrations/status', () =>
        HttpResponse.json({
          data: {
            managed_database_id: 5,
            model_id: 3,
            slug: 'whatsapp',
            current_version: null,
            latest_available: '0002',
            pending_count: 2,
            pending_versions: ['0001', '0002'],
          },
        }),
      ),
    )

    const { result } = renderHook(() => useMigrationStatus(5, true), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.pending_count).toBe(2)
    expect(result.current.data?.current_version).toBeNull()
    // Compatibilidad: sin los campos de reconciliación, los defaults del contrato aplican.
    expect(result.current.data?.has_partial_application).toBe(false)
    expect(result.current.data?.partial_application).toEqual([])
  })

  it('expone la aplicación parcial (§9)', async () => {
    server.use(
      http.get('http://localhost/api/v1/managed-databases/5/migrations/status', () =>
        HttpResponse.json({
          data: {
            managed_database_id: 5,
            model_id: 3,
            slug: 'whatsapp',
            current_version: '0007',
            latest_available: '0008',
            pending_count: 1,
            pending_versions: ['0008'],
            has_partial_application: true,
            partial_application: [
              {
                version: '0008',
                model_migration_id: 8,
                applied_statements: 6,
                total_statements: 12,
                reconcilable: true,
                statements_to_undo: 6,
              },
              {
                version: '0009',
                model_migration_id: 9,
                applied_statements: 1,
                total_statements: 3,
                reconcilable: false,
                reason: 'La sentencia 1 no tiene reverso conocido.',
                statements_to_undo: 0,
              },
            ],
          },
        }),
      ),
    )

    const { result } = renderHook(() => useMigrationStatus(5, true), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.has_partial_application).toBe(true)
    expect(result.current.data?.partial_application).toHaveLength(2)
    expect(result.current.data?.partial_application[0]?.reconcilable).toBe(true)
    expect(result.current.data?.partial_application[1]?.reason).toMatch(/reverso/)
  })
})

describe('useApplyMigrations', () => {
  it('discrimina el resultado de dry-run', async () => {
    server.use(
      http.post('http://localhost/api/v1/managed-databases/5/migrations/apply', () =>
        HttpResponse.json({
          data: {
            managed_database_id: 5,
            database_name: 'app_prod',
            server_id: 42,
            dry_run: true,
            current_version: null,
            pending_versions: ['0001', '0002'],
            pending_count: 2,
          },
        }),
      ),
    )

    const { result } = renderHook(() => useApplyMigrations(5), { wrapper })

    act(() => {
      result.current.mutate({ dryRun: true })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const data = result.current.data
    expect(data && isDryRunResult(data)).toBe(true)
  })

  it('envía on_failure y parsea reconciliation + checkpoints de results[] (§9)', async () => {
    let onFailureParam: string | null = null
    server.use(
      http.post('http://localhost/api/v1/managed-databases/5/migrations/apply', ({ request }) => {
        onFailureParam = new URL(request.url).searchParams.get('on_failure')
        return HttpResponse.json({
          data: {
            managed_database_id: 5,
            from_version: '0007',
            to_version: '0007',
            applied_count: 0,
            failed: true,
            results: [
              {
                migration_id: 8,
                version: '0008',
                status: 'failed',
                error: 'boom',
                resumed: true,
                resumed_from_statement: 6,
                statement_total: 12,
                failed_at_statement_index: 7,
              },
            ],
            reconciliation: {
              version: '0008',
              attempted: true,
              undone_count: 2,
              statements_to_undo: 2,
              fully_reconciled: true,
              unconfirmed_reverses: [],
              unreversible_statements: [],
              error: null,
            },
          },
        })
      }),
    )

    const { result } = renderHook(() => useApplyMigrations(5), { wrapper })

    act(() => {
      result.current.mutate({ dryRun: false, onFailure: 'reconcile' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(onFailureParam).toBe('reconcile')
    expect(result.current.data?.reconciliation?.fully_reconciled).toBe(true)
    const item = result.current.data?.results[0]
    expect(item?.resumed).toBe(true)
    expect(item?.resumed_from_statement).toBe(6)
    expect(item?.failed_at_statement_index).toBe(7)
    expect(item?.statement_total).toBe(12)
  })
})

describe('useStampMigration', () => {
  it('envía force como query param', async () => {
    let forceParam: string | null = null
    server.use(
      http.post('http://localhost/api/v1/managed-databases/5/migrations/stamp', ({ request }) => {
        forceParam = new URL(request.url).searchParams.get('force')
        return HttpResponse.json({ data: { managed_database_id: 5, version: '0008' } })
      }),
    )

    const { result } = renderHook(() => useStampMigration(5), { wrapper })

    act(() => {
      result.current.mutate({ version: '0008', force: true })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(forceParam).toBe('true')
  })
})

describe('useReconcilePreview', () => {
  it('ante el 409 de force (sentencias sin reverso) reintenta el dry-run con force=true', async () => {
    const forcedCalls: Array<string | null> = []
    server.use(
      http.post(
        'http://localhost/api/v1/managed-databases/5/migrations/reconcile-partial',
        ({ request }) => {
          const url = new URL(request.url)
          forcedCalls.push(url.searchParams.get('force'))
          // El backend valida `force` ANTES de `dry_run`: 409 incluso en dry-run (§9).
          if (url.searchParams.get('force') !== 'true') {
            return HttpResponse.json(
              {
                detail: {
                  msg: 'Hay sentencias sin reverso conocido; requiere force=true.',
                  type: 'AppHttpException',
                  public_context: {
                    unreversible_statements: ['DROP INDEX ix_email ON users'],
                  },
                },
              },
              { status: 409 },
            )
          }
          return HttpResponse.json({
            data: {
              managed_database_id: 5,
              database_name: 'app_prod',
              server_id: 42,
              version: '0008',
              applied_statements: 6,
              total_statements: 12,
              statements_to_undo: 5,
              unreversible_statements: ['DROP INDEX ix_email ON users'],
              unconfirmed_reverses: ['DROP TABLE audit_tmp'],
              dry_run: true,
              statements: [
                { seq: 6, sql: 'DROP TABLE audit_tmp' },
                { seq: 5, sql: 'ALTER TABLE users DROP COLUMN phone' },
              ],
            },
          })
        },
      ),
    )

    const { result } = renderHook(() => useReconcilePreview(5, '0008', true), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(forcedCalls).toEqual([null, 'true'])
    expect(result.current.data?.requiresForce).toBe(true)
    expect(result.current.data?.plan.statements).toHaveLength(2)
    expect(result.current.data?.plan.unconfirmed_reverses).toEqual(['DROP TABLE audit_tmp'])
  })

  it('sin 409, devuelve el plan con requiresForce=false', async () => {
    server.use(
      http.post(
        'http://localhost/api/v1/managed-databases/5/migrations/reconcile-partial',
        ({ request }) => {
          const url = new URL(request.url)
          expect(url.searchParams.get('confirm_version')).toBe('0008')
          expect(url.searchParams.get('dry_run')).toBe('true')
          return HttpResponse.json({
            data: {
              managed_database_id: 5,
              version: '0008',
              applied_statements: 2,
              total_statements: 4,
              statements_to_undo: 2,
              dry_run: true,
              statements: [{ seq: 2, sql: 'DROP TABLE t2' }],
            },
          })
        },
      ),
    )

    const { result } = renderHook(() => useReconcilePreview(5, '0008', true), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.requiresForce).toBe(false)
    expect(result.current.data?.plan.unreversible_statements).toEqual([])
  })
})

describe('useReconcilePartial', () => {
  it('ejecuta con dry_run=false y parsea el resultado real', async () => {
    let dryRunParam: string | null = null
    server.use(
      http.post(
        'http://localhost/api/v1/managed-databases/5/migrations/reconcile-partial',
        ({ request }) => {
          dryRunParam = new URL(request.url).searchParams.get('dry_run')
          return HttpResponse.json({
            data: {
              managed_database_id: 5,
              version: '0008',
              applied_statements: 6,
              total_statements: 12,
              statements_to_undo: 5,
              dry_run: false,
              undone_count: 5,
              failed: false,
              fully_reconciled: true,
              remaining_applied_statements: 0,
              results: [{ seq: 6, ok: true, execution_ms: 12 }],
            },
          })
        },
      ),
    )

    const { result } = renderHook(() => useReconcilePartial(5), { wrapper })

    act(() => {
      result.current.mutate({ confirmVersion: '0008', force: true })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(dryRunParam).toBe('false')
    expect(result.current.data?.fully_reconciled).toBe(true)
    expect(result.current.data?.remaining_applied_statements).toBe(0)
    expect(result.current.data?.results[0]?.seq).toBe(6)
  })
})
