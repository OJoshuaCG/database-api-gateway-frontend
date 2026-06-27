import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { isDryRunResult } from '@/lib/contracts'
import { useApplyMigrations, useMigrationStatus } from './use-db-migrations'

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
})
